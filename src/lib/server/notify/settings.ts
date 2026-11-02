import { randomInt } from 'node:crypto';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config';
import { encrypt, safeEqual, sha256Hex } from '../crypto';
import { db, schema } from '../db';
import { AppError, redact } from '../errors';
import { muteExpiry } from './mute';
import { pushSubscriptionAad } from './outbox';
import { loadProfileWithOwnerRole, profilePermitted, profileToSender, resolveSender, smtpPasswordAad } from './sender';
import { realTransports, type Transports } from './transports';

/** Owner-scoped notification settings, recipient verification, push devices, mute and SMTP profiles. */

const UUID_RE = /^[0-9a-f-]{36}$/i;
const CHALLENGE_TTL_MS = 15 * 60_000;
const CHALLENGE_MIN_INTERVAL_MS = 60_000;
const CHALLENGE_MAX_ATTEMPTS = 5;

const emailSchema = z.email().max(254);

function validation(message: string, details?: unknown): AppError {
	return new AppError('VALIDATION_FAILED', message, null, details);
}

async function ensureSettingsRow(ownerId: string) {
	await db().insert(schema.notificationSettings).values({ ownerId }).onConflictDoNothing();
	const [row] = await db().select().from(schema.notificationSettings).where(eq(schema.notificationSettings.ownerId, ownerId)).limit(1);
	return row!;
}

// ---------- settings ----------

export interface NotificationSettingsView {
	emailEnabled: boolean;
	pushEnabled: boolean;
	recipientEmail: string | null;
	recipientVerified: boolean;
	pendingRecipient: string | null;
	challengeExpiresAt: Date | null;
	smtpProfileId: string | null;
	loginEmail: string | null;
	loginEmailVerified: boolean;
	pushConfigured: boolean;
	vapidPublicKey: string | null;
	pushSubscriptions: Array<{ id: string; deviceLabel: string | null; status: string; createdAt: Date; expiredAt: Date | null }>;
}

export async function getSettings(ownerId: string): Promise<NotificationSettingsView> {
	const s = await ensureSettingsRow(ownerId);
	const [user] = await db()
		.select({ email: schema.users.email, emailVerified: schema.users.emailVerified })
		.from(schema.users)
		.where(eq(schema.users.id, ownerId))
		.limit(1);
	const subs = await db()
		.select({
			id: schema.pushSubscriptions.id,
			deviceLabel: schema.pushSubscriptions.deviceLabel,
			status: schema.pushSubscriptions.status,
			createdAt: schema.pushSubscriptions.createdAt,
			expiredAt: schema.pushSubscriptions.expiredAt
		})
		.from(schema.pushSubscriptions)
		.where(and(eq(schema.pushSubscriptions.ownerId, ownerId), sql`${schema.pushSubscriptions.status} <> 'revoked'`))
		.orderBy(schema.pushSubscriptions.createdAt);
	const v = config().vapid;
	return {
		emailEnabled: s.emailEnabled,
		pushEnabled: s.pushEnabled,
		recipientEmail: s.recipientEmail,
		recipientVerified: !!(s.recipientEmail && s.recipientVerifiedAt),
		pendingRecipient: s.pendingRecipient,
		challengeExpiresAt: s.challengeExpiresAt,
		smtpProfileId: s.smtpProfileId,
		loginEmail: user?.email ?? null,
		loginEmailVerified: !!user?.emailVerified,
		pushConfigured: !!(v.publicKey && v.privateKey && v.subject),
		vapidPublicKey: v.publicKey ?? null,
		pushSubscriptions: subs
	};
}

const updateSchema = z
	.object({
		emailEnabled: z.boolean().optional(),
		pushEnabled: z.boolean().optional(),
		smtpProfileId: z.string().regex(UUID_RE).nullable().optional()
	})
	.strict();

/**
 * Channels are independent: each flag changes only when explicitly given.
 * Choosing a sender profile requires that the user may use it and that it is verified.
 */
export async function updateSettings(
	ownerId: string,
	patch: { emailEnabled?: boolean; pushEnabled?: boolean; smtpProfileId?: string | null }
): Promise<NotificationSettingsView> {
	const parsed = updateSchema.safeParse(patch);
	if (!parsed.success) throw validation('invalid notification settings', parsed.error.issues);
	const p = parsed.data;
	await ensureSettingsRow(ownerId);
	if (typeof p.smtpProfileId === 'string') {
		const row = await loadProfileWithOwnerRole(p.smtpProfileId);
		if (!row || !profilePermitted(row.profile, ownerId, row.ownerRole)) throw new AppError('NOT_FOUND', 'not found');
		if (!row.profile.verifiedAt) throw new AppError('CONFLICT', '확인되지 않은 발신 프로필');
	}
	const set: Partial<typeof schema.notificationSettings.$inferInsert> = { updatedAt: new Date() };
	if (p.emailEnabled !== undefined) set.emailEnabled = p.emailEnabled;
	if (p.pushEnabled !== undefined) set.pushEnabled = p.pushEnabled;
	if (p.smtpProfileId !== undefined) set.smtpProfileId = p.smtpProfileId;
	await db().update(schema.notificationSettings).set(set).where(eq(schema.notificationSettings.ownerId, ownerId));
	return getSettings(ownerId);
}

// ---------- recipient verification ----------

function challengeDigest(ownerId: string, email: string, code: string): string {
	return sha256Hex(`recipient-challenge:${ownerId}:${email.trim().toLowerCase()}:${code}`);
}

/** challenge_hash column format: `<attempts>:<sha256>` (the plain code is never stored). */
function parseChallenge(stored: string | null): { attempts: number; hash: string } | null {
	if (!stored) return null;
	const m = /^(\d+):([0-9a-f]{64})$/.exec(stored);
	return m ? { attempts: Number(m[1]), hash: m[2]! } : null;
}

const clearedChallenge = { pendingRecipient: null, challengeHash: null, challengeExpiresAt: null };

/**
 * Start verifying a new recipient address: a 6-digit code is mailed to it via
 * the user's permitted sender. The new address is not used until confirmed.
 */
export async function startRecipientChange(
	ownerId: string,
	email: string,
	transports: Transports = realTransports(),
	opts: { now?: Date } = {}
): Promise<{ pendingRecipient: string; expiresAt: Date }> {
	const parsed = emailSchema.safeParse(String(email ?? '').trim());
	if (!parsed.success) throw validation('올바른 이메일 주소가 아님');
	const address = parsed.data;
	const now = opts.now ?? new Date();
	const current = await ensureSettingsRow(ownerId);
	if (current.challengeExpiresAt && current.pendingRecipient) {
		const issuedAt = current.challengeExpiresAt.getTime() - CHALLENGE_TTL_MS;
		if (now.getTime() - issuedAt < CHALLENGE_MIN_INTERVAL_MS) {
			throw new AppError('CONFLICT', '잠시 후 다시 요청하세요');
		}
	}
	const sender = await resolveSender(ownerId);
	const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
	const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
	await db()
		.update(schema.notificationSettings)
		.set({
			pendingRecipient: address,
			challengeHash: `0:${challengeDigest(ownerId, address, code)}`,
			challengeExpiresAt: expiresAt,
			updatedAt: now
		})
		.where(eq(schema.notificationSettings.ownerId, ownerId));
	try {
		await transports.sendMail(sender, {
			from: sender.fromAddress,
			to: address,
			subject: '[알림 수신 주소 확인] 확인 코드',
			text: `알림 수신 주소 확인 코드: ${code}\n\n15분 안에 웹 화면에 입력하세요. 요청하지 않았다면 이 메일을 무시하세요.`
		});
	} catch (err) {
		await db()
			.update(schema.notificationSettings)
			.set({ ...clearedChallenge, updatedAt: new Date() })
			.where(eq(schema.notificationSettings.ownerId, ownerId));
		throw new AppError('DELIVERY_FAILED', redact(`확인 메일 전송 실패: ${(err as Error)?.message ?? 'unknown'}`).slice(0, 500));
	}
	return { pendingRecipient: address, expiresAt };
}

export async function confirmRecipientChange(ownerId: string, code: string, opts: { now?: Date } = {}): Promise<NotificationSettingsView> {
	const now = opts.now ?? new Date();
	const outcome = await db().transaction(async (tx) => {
		const [s] = await tx
			.select()
			.from(schema.notificationSettings)
			.where(eq(schema.notificationSettings.ownerId, ownerId))
			.limit(1)
			.for('update');
		const ch = parseChallenge(s?.challengeHash ?? null);
		if (!s || !s.pendingRecipient || !ch || !s.challengeExpiresAt) return 'none' as const;
		if (s.challengeExpiresAt.getTime() <= now.getTime() || ch.attempts >= CHALLENGE_MAX_ATTEMPTS) {
			await tx
				.update(schema.notificationSettings)
				.set({ ...clearedChallenge, updatedAt: now })
				.where(eq(schema.notificationSettings.ownerId, ownerId));
			return 'expired' as const;
		}
		const candidate = /^\d{6}$/.test(String(code ?? '').trim()) ? challengeDigest(ownerId, s.pendingRecipient, String(code).trim()) : '';
		if (!candidate || !safeEqual(candidate, ch.hash)) {
			const attempts = ch.attempts + 1;
			await tx
				.update(schema.notificationSettings)
				.set(
					attempts >= CHALLENGE_MAX_ATTEMPTS
						? { ...clearedChallenge, updatedAt: now }
						: { challengeHash: `${attempts}:${ch.hash}`, updatedAt: now }
				)
				.where(eq(schema.notificationSettings.ownerId, ownerId));
			return 'mismatch' as const;
		}
		await tx
			.update(schema.notificationSettings)
			.set({ recipientEmail: s.pendingRecipient, recipientVerifiedAt: now, ...clearedChallenge, updatedAt: now })
			.where(eq(schema.notificationSettings.ownerId, ownerId));
		return 'ok' as const;
	});
	if (outcome === 'none') throw validation('진행 중인 수신 주소 확인이 없음');
	if (outcome === 'expired') throw validation('확인 코드가 만료되었거나 시도 횟수를 넘음');
	if (outcome === 'mismatch') throw validation('확인 코드가 일치하지 않음');
	return getSettings(ownerId);
}

/** The user's verified Google login email can be accepted as recipient without a code. */
export async function useLoginEmail(ownerId: string): Promise<NotificationSettingsView> {
	const [user] = await db().select().from(schema.users).where(eq(schema.users.id, ownerId)).limit(1);
	if (!user) throw new AppError('NOT_FOUND', 'not found');
	if (!user.emailVerified) throw new AppError('CONFLICT', '로그인 이메일이 확인되지 않음');
	await ensureSettingsRow(ownerId);
	const now = new Date();
	await db()
		.update(schema.notificationSettings)
		.set({ recipientEmail: user.email, recipientVerifiedAt: now, ...clearedChallenge, updatedAt: now })
		.where(eq(schema.notificationSettings.ownerId, ownerId));
	return getSettings(ownerId);
}

// ---------- push subscriptions ----------

const pushSchema = z.object({
	endpoint: z
		.string()
		.max(2048)
		.refine((v) => {
			try {
				return new URL(v).protocol === 'https:';
			} catch {
				return false;
			}
		}, 'endpoint must be an https URL'),
	keys: z.object({
		p256dh: z
			.string()
			.min(16)
			.max(256)
			.regex(/^[A-Za-z0-9_\-+/=]+$/),
		auth: z
			.string()
			.min(8)
			.max(64)
			.regex(/^[A-Za-z0-9_\-+/=]+$/)
	})
});

/**
 * Register (or refresh) this browser's push subscription for the user. The
 * whole subscription is encrypted; the endpoint is indexed by hash. A row
 * owned by another user is never taken over (CONFLICT).
 */
export async function registerPushSubscription(
	ownerId: string,
	sub: { endpoint: string; keys: { p256dh: string; auth: string } },
	deviceLabel?: string | null
): Promise<{ id: string; deviceLabel: string | null; status: string }> {
	const parsed = pushSchema.safeParse(sub);
	if (!parsed.success) throw validation('invalid push subscription');
	const clean = { endpoint: parsed.data.endpoint, keys: { p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth } };
	const endpointHash = sha256Hex(clean.endpoint);
	const encrypted = encrypt(JSON.stringify(clean), pushSubscriptionAad(ownerId, endpointHash));
	const label = deviceLabel
		? String(deviceLabel)
				.replace(/[\u0000-\u001F\u007F]/g, '')
				.trim()
				.slice(0, 100) || null
		: null;
	const rows = await db()
		.insert(schema.pushSubscriptions)
		.values({ ownerId, endpointHash, encryptedSubscription: encrypted, deviceLabel: label, status: 'active' })
		.onConflictDoUpdate({
			target: [schema.pushSubscriptions.ownerId, schema.pushSubscriptions.endpointHash],
			set: { encryptedSubscription: encrypted, deviceLabel: label, status: 'active', expiredAt: null }
		})
		.returning({
			id: schema.pushSubscriptions.id,
			deviceLabel: schema.pushSubscriptions.deviceLabel,
			status: schema.pushSubscriptions.status
		});
	if (rows.length === 0) throw new AppError('CONFLICT', '구독을 저장하지 못함');
	return rows[0]!;
}

/** Revoke one of the user's own devices; the stored subscription secret is erased. */
export async function unregisterPushSubscription(ownerId: string, id: string): Promise<void> {
	if (!UUID_RE.test(id)) throw new AppError('NOT_FOUND', 'not found');
	const rows = await db()
		.update(schema.pushSubscriptions)
		.set({ status: 'revoked', encryptedSubscription: '', expiredAt: new Date() })
		.where(and(eq(schema.pushSubscriptions.id, id), eq(schema.pushSubscriptions.ownerId, ownerId)))
		.returning({ id: schema.pushSubscriptions.id });
	if (rows.length === 0) throw new AppError('NOT_FOUND', 'not found');
}

// ---------- daily mute ----------

/** "오늘은 알림 더 표시 안함": suppress this task's normal notifications until the next KST midnight. */
export async function muteToday(ownerId: string, taskId: string, now: Date = new Date()): Promise<{ taskId: string; muteUntil: Date }> {
	if (!UUID_RE.test(taskId)) throw new AppError('NOT_FOUND', 'not found');
	const [task] = await db()
		.select({ id: schema.tasks.id })
		.from(schema.tasks)
		.where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.ownerId, ownerId)))
		.limit(1);
	if (!task) throw new AppError('NOT_FOUND', 'not found');
	const muteUntil = muteExpiry(now);
	await db()
		.insert(schema.muteRules)
		.values({ ownerId, taskId, muteUntil })
		.onConflictDoUpdate({ target: [schema.muteRules.ownerId, schema.muteRules.taskId], set: { muteUntil } });
	return { taskId, muteUntil };
}

// ---------- SMTP sender profiles ----------

const hostRe = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

const profileSchema = z
	.object({
		label: z.string().trim().min(1).max(100),
		host: z.string().trim().regex(hostRe, 'host name only (no scheme or path)'),
		port: z.number().int().min(1).max(65535),
		secure: z.boolean(),
		username: z.string().max(320),
		password: z.string().max(1024),
		fromAddress: emailSchema
	})
	.strict();

export interface SenderProfileView {
	id: string;
	label: string;
	fromAddress: string;
	verified: boolean;
	verifiedAt: Date | null;
	shared: boolean;
	own: boolean;
	/** Connection details are shown only to the profile owner. */
	host?: string;
	port?: number;
	secure?: boolean;
	username?: string;
}

function profileView(p: typeof schema.smtpProfiles.$inferSelect, viewerId: string | null): SenderProfileView {
	const own = p.ownerId === viewerId;
	const view: SenderProfileView = {
		id: p.id,
		label: p.label,
		fromAddress: p.fromAddress,
		verified: !!p.verifiedAt,
		verifiedAt: p.verifiedAt,
		shared: p.shared,
		own
	};
	if (own) Object.assign(view, { host: p.host, port: p.port, secure: p.secure, username: p.username });
	return view;
}

/**
 * Create a sender profile. ownerId = user id for a personal profile; null for
 * an administrator-shared profile (the caller MUST have checked the admin
 * role). The profile is unverified until `verifySmtpProfile` succeeds.
 */
export async function createSmtpProfile(
	ownerId: string | null,
	input: { label: string; host: string; port: number; secure: boolean; username: string; password: string; fromAddress: string }
): Promise<SenderProfileView> {
	const parsed = profileSchema.safeParse(input);
	if (!parsed.success)
		throw validation(
			'invalid SMTP profile',
			parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
		);
	const p = parsed.data;
	if (!p.secure && p.port === 465) throw validation('port 465 requires secure=true');
	const [{ id }] = (await db().execute<{ id: string }>(sql`select uuidv7() as id`)).rows as [{ id: string }];
	const [row] = await db()
		.insert(schema.smtpProfiles)
		.values({
			id,
			ownerId,
			shared: ownerId === null,
			label: p.label,
			host: p.host.toLowerCase(),
			port: p.port,
			secure: p.secure,
			username: p.username,
			encryptedPassword: encrypt(p.password, smtpPasswordAad(id)),
			fromAddress: p.fromAddress,
			verifiedAt: null
		})
		.returning();
	return profileView(row!, ownerId);
}

/**
 * Real SMTP connection/auth check through the transport (nodemailer verify()).
 * `actorOwnerId`: when given (user id, or null for admin-shared), the profile
 * must belong to that owner. Failure clears verification.
 */
export async function verifySmtpProfile(
	id: string,
	transports: Transports = realTransports(),
	opts: { actorOwnerId?: string | null } = {}
): Promise<SenderProfileView> {
	const row = await loadProfileWithOwnerRole(id);
	if (!row) throw new AppError('NOT_FOUND', 'not found');
	if (opts.actorOwnerId !== undefined && row.profile.ownerId !== opts.actorOwnerId) throw new AppError('NOT_FOUND', 'not found');
	try {
		await transports.verifyMail(profileToSender(row.profile));
	} catch (err) {
		await db().update(schema.smtpProfiles).set({ verifiedAt: null }).where(eq(schema.smtpProfiles.id, id));
		throw new AppError('DELIVERY_FAILED', redact(`SMTP 확인 실패: ${(err as Error)?.message ?? 'unknown'}`).slice(0, 500));
	}
	const [updated] = await db()
		.update(schema.smtpProfiles)
		.set({ verifiedAt: new Date() })
		.where(eq(schema.smtpProfiles.id, id))
		.returning();
	return profileView(updated!, row.profile.ownerId);
}

/** Profiles the user may choose: own profiles plus administrator-shared ones. No secrets. */
export async function listSenderProfiles(ownerId: string): Promise<SenderProfileView[]> {
	const rows = await db()
		.select({ profile: schema.smtpProfiles })
		.from(schema.smtpProfiles)
		.leftJoin(schema.users, eq(schema.users.id, schema.smtpProfiles.ownerId))
		.where(
			or(
				eq(schema.smtpProfiles.ownerId, ownerId),
				and(eq(schema.smtpProfiles.shared, true), or(isNull(schema.smtpProfiles.ownerId), eq(schema.users.role, 'admin')))
			)
		)
		.orderBy(schema.smtpProfiles.createdAt);
	return rows.map((r) => profileView(r.profile, ownerId));
}
