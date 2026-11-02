import { and, eq, lt, ne, or, sql } from 'drizzle-orm';
import { config } from '../config';
import { db, schema } from '../db';
import { AppError, redact } from '../errors';
import { resolveSender } from '../notify/sender';
import { realTransports, type Transports } from '../notify/transports';

// SMTP calls are bounded; a process crash must not trigger an automatic resend.
export const INVITATION_SEND_STALE_MS = 5 * 60_000;
const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function sendInvitationEmail(
	adminId: string,
	invitationId: string,
	expectedAttempts: number,
	transports: Transports = realTransports()
) {
	if (!UUID_RE.test(invitationId)) throw new AppError('NOT_FOUND', 'not found');
	if (!Number.isSafeInteger(expectedAttempts) || expectedAttempts < 0) throw new AppError('VALIDATION_FAILED', '잘못된 발송 시도 번호');
	const [admin] = await db()
		.select({ role: schema.users.role, active: schema.users.active })
		.from(schema.users)
		.where(eq(schema.users.id, adminId))
		.limit(1);
	if (!admin?.active || admin.role !== 'admin') throw new AppError('NOT_FOUND', 'not found');

	const [claimed] = await db()
		.update(schema.invitations)
		.set({
			emailStatus: 'sending',
			emailAttempts: sql`${schema.invitations.emailAttempts} + 1`,
			emailAttemptedAt: new Date(),
			emailLastError: null
		})
		.where(
			and(
				eq(schema.invitations.id, invitationId),
				eq(schema.invitations.status, 'active'),
				eq(schema.invitations.emailAttempts, expectedAttempts),
				or(
					ne(schema.invitations.emailStatus, 'sending'),
					lt(schema.invitations.emailAttemptedAt, new Date(Date.now() - INVITATION_SEND_STALE_MS))
				)
			)
		)
		.returning();
	if (!claimed) {
		const [current] = await db().select().from(schema.invitations).where(eq(schema.invitations.id, invitationId)).limit(1);
		if (!current) throw new AppError('NOT_FOUND', 'not found');
		if (current.status !== 'active') throw new AppError('CONFLICT', '대기 중인 초대에만 안내 메일을 보낼 수 있습니다');
		if (current.emailStatus === 'sending') throw new AppError('CONFLICT', '이미 메일을 발송 중입니다. 상태가 불확실하면 5분 후 확인하세요');
		// The same UI request was already handled. Do not send a second message.
		if (current.emailAttempts > expectedAttempts) return current;
		throw new AppError('CONFLICT', '초대 상태가 변경되었습니다. 새로고침 후 다시 시도하세요');
	}

	let failure: string | null = null;
	try {
		const sender = await resolveSender(adminId);
		const login = new URL('/login', config().publicOrigin).toString();
		const operator = config().operator.name;
		await transports.sendMail(sender, {
			from: sender.fromAddress,
			to: claimed.email,
			subject: `[Yeeun] ${operator}님의 서비스 초대`,
			text: [
				`${operator}님이 Yeeun 업무 자동화 서비스에 초대했습니다.`,
				'',
				`초대된 Google 계정: ${claimed.email}`,
				`역할: ${claimed.role === 'admin' ? '관리자' : '사용자'}`,
				'',
				`다음 주소에서 위 Google 계정으로 로그인하세요: ${login}`,
				'이 메일의 링크만으로는 로그인되지 않으며, 초대된 Google 계정 인증이 필요합니다.',
				'초대가 취소되면 이 안내 메일을 받아도 서비스를 이용할 수 없습니다.'
			].join('\n')
		});
	} catch (err) {
		failure = redact(err instanceof Error ? err.message : String(err)).slice(0, 500);
	}

	// SMTP acceptance and persistence are separate. If this transaction fails,
	// leave 'sending' uncertain instead of automatically sending again.
	return db().transaction(async (tx) => {
		const [updated] = await tx
			.update(schema.invitations)
			.set({
				emailStatus: failure === null ? 'sent' : 'failed',
				emailSentAt: failure === null ? new Date() : claimed.emailSentAt,
				emailLastError: failure
			})
			.where(and(eq(schema.invitations.id, invitationId), eq(schema.invitations.emailAttempts, claimed.emailAttempts)))
			.returning();
		if (!updated) throw new AppError('CONFLICT', '발송 상태가 변경되었습니다');
		await tx.insert(schema.auditEvents).values({
			actorId: adminId,
			action: failure === null ? 'invitation.email.sent' : 'invitation.email.failed',
			resourceType: 'invitation',
			resourceId: invitationId,
			meta: { attempt: claimed.emailAttempts }
		});
		return updated;
	});
}
