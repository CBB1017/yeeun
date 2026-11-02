import { eq } from 'drizzle-orm';
import { config } from '../config';
import { decrypt } from '../crypto';
import { db, schema, type DbOrTx } from '../db';
import { AppError } from '../errors';
import type { SmtpSender } from './transports';

type ProfileRow = typeof schema.smtpProfiles.$inferSelect;

export function smtpPasswordAad(profileId: string): string {
	return `smtp-profile:${profileId}`;
}

/**
 * A user may send with a profile they own, or with a profile an administrator
 * shared (owner null = created as an admin shared profile, or owner is an admin).
 */
export function profilePermitted(p: ProfileRow, ownerId: string, profileOwnerRole: string | null): boolean {
	if (p.ownerId === ownerId) return true;
	return p.shared && (p.ownerId === null || profileOwnerRole === 'admin');
}

export function profileToSender(p: ProfileRow): SmtpSender {
	return {
		source: 'profile',
		profileId: p.id,
		host: p.host,
		port: p.port,
		secure: p.secure,
		username: p.username || undefined,
		password: p.username ? decrypt(p.encryptedPassword, smtpPasswordAad(p.id)) : undefined,
		fromAddress: p.fromAddress
	};
}

export async function loadProfileWithOwnerRole(profileId: string, tx: DbOrTx = db()) {
	if (!/^[0-9a-f-]{36}$/i.test(profileId)) return null;
	const [row] = await tx
		.select({ profile: schema.smtpProfiles, ownerRole: schema.users.role })
		.from(schema.smtpProfiles)
		.leftJoin(schema.users, eq(schema.users.id, schema.smtpProfiles.ownerId))
		.where(eq(schema.smtpProfiles.id, profileId))
		.limit(1);
	return row ?? null;
}

/** Operator default sender from config (SMTP_* env / secret files), if fully configured. */
export function operatorDefaultSender(): SmtpSender | null {
	const s = config().smtpDefault;
	if (!s.host || !s.port || !s.from) return null;
	if (s.user && !s.password) return null;
	return {
		source: 'operator_default',
		profileId: null,
		host: s.host,
		port: s.port,
		secure: s.secure,
		username: s.user,
		password: s.user ? s.password : undefined,
		fromAddress: s.from
	};
}

/**
 * Sender resolution: the user's selected profile if permitted and verified;
 * otherwise the operator default; otherwise DELIVERY_FAILED. The From address
 * is always the profile's verified from_address.
 */
export async function resolveSender(ownerId: string, tx: DbOrTx = db()): Promise<SmtpSender> {
	const [settings] = await tx
		.select({ smtpProfileId: schema.notificationSettings.smtpProfileId })
		.from(schema.notificationSettings)
		.where(eq(schema.notificationSettings.ownerId, ownerId))
		.limit(1);
	if (settings?.smtpProfileId) {
		const row = await loadProfileWithOwnerRole(settings.smtpProfileId, tx);
		if (row && row.profile.verifiedAt && profilePermitted(row.profile, ownerId, row.ownerRole)) {
			return profileToSender(row.profile);
		}
	}
	const fallback = operatorDefaultSender();
	if (fallback) return fallback;
	throw new AppError('DELIVERY_FAILED', 'sender not configured');
}
