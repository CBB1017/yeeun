import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { config } from '../config';
import { AppError } from '../errors';
import { randomToken, sha256Hex } from '../crypto';
import type { FlowResult } from './google-oidc';
import { sendInvitationEmail } from './invitation-email';
import type { Transports } from '../notify/transports';

/** Invitation-only identity: users are keyed by Google subject; invitations by email. */

export const SESSION_COOKIE = 'yeeun_session';
const SESSION_DAYS = 14;

export type SessionUser = typeof schema.users.$inferSelect & { sessionId: string; csrfToken: string };

export async function signInWithGoogle(r: FlowResult): Promise<typeof schema.users.$inferSelect> {
	if (!r.emailVerified || !r.email) throw new AppError('INVITATION_REQUIRED', '확인된 Google 이메일이 필요합니다');
	return db().transaction(async (tx) => {
		const [existing] = await tx.select().from(schema.users).where(eq(schema.users.googleSub, r.sub)).limit(1);
		if (existing) {
			if (!existing.active) throw new AppError('INVITATION_REQUIRED', '초대가 취소된 계정입니다');
			await tx.update(schema.users).set({ email: r.email, name: r.name, updatedAt: new Date() }).where(eq(schema.users.id, existing.id));
			return existing;
		}
		await tx.execute(sql`select pg_advisory_xact_lock(727003)`);
		const [inv] = await tx
			.select()
			.from(schema.invitations)
			.where(and(eq(schema.invitations.email, r.email), eq(schema.invitations.status, 'active')))
			.limit(1);
		const bootstrap = config().bootstrapAdminEmail;
		let role: 'admin' | 'user' | null = inv ? (inv.role as 'admin' | 'user') : null;
		if (!role && bootstrap && bootstrap === r.email) {
			const admins = await tx.execute<{ n: number }>(sql`select count(*)::int as n from users where role = 'admin'`);
			if (admins.rows[0]!.n === 0) role = 'admin';
		}
		if (!role) throw new AppError('INVITATION_REQUIRED', '초대된 계정만 사용할 수 있습니다');
		const [user] = await tx
			.insert(schema.users)
			.values({ googleSub: r.sub, email: r.email, emailVerified: true, name: r.name, role })
			.returning();
		if (inv) {
			await tx
				.update(schema.invitations)
				.set({ status: 'accepted', boundUserId: user!.id, acceptedAt: new Date() })
				.where(eq(schema.invitations.id, inv.id));
		} else {
			await tx
				.insert(schema.invitations)
				.values({ email: r.email, status: 'accepted', boundUserId: user!.id, role: 'admin', acceptedAt: new Date() });
		}
		await tx.insert(schema.auditEvents).values({
			actorId: user!.id,
			action: 'user.created',
			resourceType: 'user',
			resourceId: user!.id,
			meta: { via: inv ? 'invitation' : 'bootstrap' }
		});
		return user!;
	});
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
	const token = randomToken(32);
	const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
	await db()
		.insert(schema.sessions)
		.values({ userId, tokenHash: sha256Hex(token), csrfToken: randomToken(24), expiresAt });
	return { token, expiresAt };
}

export async function userForSession(token: string | undefined): Promise<SessionUser | null> {
	if (!token || token.length > 200) return null;
	const rows = await db()
		.select({ user: schema.users, session: schema.sessions })
		.from(schema.sessions)
		.innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
		.where(
			and(
				eq(schema.sessions.tokenHash, sha256Hex(token)),
				isNull(schema.sessions.revokedAt),
				gt(schema.sessions.expiresAt, new Date()),
				eq(schema.users.active, true)
			)
		)
		.limit(1);
	const r = rows[0];
	if (!r) return null;
	if (Date.now() - r.session.lastSeenAt.getTime() > 5 * 60_000) {
		await db().update(schema.sessions).set({ lastSeenAt: new Date() }).where(eq(schema.sessions.id, r.session.id));
	}
	return { ...r.user, sessionId: r.session.id, csrfToken: r.session.csrfToken };
}

export async function revokeSession(sessionId: string) {
	await db().update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.id, sessionId));
}

// ---------- invitations (admin) ----------

export async function listInvitations() {
	return db()
		.select()
		.from(schema.invitations)
		.orderBy(sql`${schema.invitations.createdAt} desc`);
}

export async function invite(adminId: string, email: string, role: 'admin' | 'user' = 'user', transports?: Transports) {
	const e = email.trim().toLowerCase();
	if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new AppError('VALIDATION_FAILED', '이메일 형식 오류');
	const [admin] = await db()
		.select({ role: schema.users.role, active: schema.users.active })
		.from(schema.users)
		.where(eq(schema.users.id, adminId))
		.limit(1);
	if (!admin?.active || admin.role !== 'admin') throw new AppError('NOT_FOUND', 'not found');
	const row = await db().transaction(async (tx) => {
		const [created] = await tx.insert(schema.invitations).values({ email: e, invitedBy: adminId, role }).onConflictDoNothing().returning();
		if (!created) throw new AppError('CONFLICT', '이미 초대된 이메일');
		await tx
			.insert(schema.auditEvents)
			.values({ actorId: adminId, action: 'invitation.created', resourceType: 'invitation', resourceId: created.id, meta: {} });
		return created;
	});
	return sendInvitationEmail(adminId, row.id, 0, transports);
}

/** Revoke immediately blocks sessions, task execution and downloads for the bound user. */
export async function revokeInvitation(adminId: string, invitationId: string) {
	return db().transaction(async (tx) => {
		const [inv] = await tx
			.update(schema.invitations)
			.set({ status: 'revoked', revokedAt: new Date() })
			.where(and(eq(schema.invitations.id, invitationId), ne(schema.invitations.status, 'revoked')))
			.returning();
		if (!inv) throw new AppError('NOT_FOUND', 'not found');
		if (inv.boundUserId) {
			if (inv.boundUserId === adminId) throw new AppError('CONFLICT', '자기 자신의 초대는 취소할 수 없음');
			await tx.update(schema.users).set({ active: false, updatedAt: new Date() }).where(eq(schema.users.id, inv.boundUserId));
			await tx
				.update(schema.sessions)
				.set({ revokedAt: new Date() })
				.where(and(eq(schema.sessions.userId, inv.boundUserId), isNull(schema.sessions.revokedAt)));
			await tx.execute(
				sql`update runs set state = 'cancelled', error_code = 'CANCELLED', error_stage = state, finished_at = now() where owner_id = ${inv.boundUserId} and state in ('queued','review_queued','awaiting_review')`
			);
			await tx.execute(
				sql`update runs set cancel_requested_at = now() where owner_id = ${inv.boundUserId} and state in ('preparing','executing','comparing','finalizing')`
			);
			await tx.execute(sql`update schedules set active = false where owner_id = ${inv.boundUserId}`);
		}
		await tx
			.insert(schema.auditEvents)
			.values({ actorId: adminId, action: 'invitation.revoked', resourceType: 'invitation', resourceId: inv.id, meta: {} });
		return inv;
	});
}
