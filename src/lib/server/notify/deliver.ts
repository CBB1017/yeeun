import { and, desc, eq, sql } from 'drizzle-orm';
import { decrypt } from '../crypto';
import { db, schema } from '../db';
import { AppError, isAppError, redact } from '../errors';
import { emailDestinationHash, pushSubscriptionAad } from './outbox';
import { emailMessage, type EmailPayload, type PushPayload } from './payload';
import { resolveSender } from './sender';
import { realTransports, type PushTarget, type Transports } from './transports';

/**
 * Outbox delivery. Each claimed row gets exactly ONE attempt:
 * accepted by SMTP/push service -> 'sent'; anything else -> 'delivery_failed'.
 * No automatic retry, no model rerun, and no notification is ever created
 * about a failed notification. Retrying is the explicit user action `resend`.
 */

type ClaimedRow = {
	id: string;
	owner_id: string;
	channel: 'email' | 'push';
	destination_hash: string;
	payload: unknown;
};

const UUID_RE = /^[0-9a-f-]{36}$/i;

function errorText(err: unknown): string {
	const code = isAppError(err) ? err.code : 'DELIVERY_FAILED';
	const msg = err instanceof Error ? err.message : String(err);
	return redact(`${code}: ${msg}`).slice(0, 500);
}

async function deliverEmail(row: ClaimedRow, transports: Transports): Promise<void> {
	const [settings] = await db()
		.select()
		.from(schema.notificationSettings)
		.where(eq(schema.notificationSettings.ownerId, row.owner_id))
		.limit(1);
	const recipient = settings?.recipientEmail;
	if (!recipient || !settings.recipientVerifiedAt) throw new AppError('DELIVERY_FAILED', 'recipient not verified');
	if (emailDestinationHash(row.owner_id, recipient) !== row.destination_hash) {
		throw new AppError('DELIVERY_FAILED', 'recipient changed after the notification was created');
	}
	const sender = await resolveSender(row.owner_id);
	const { subject, text } = emailMessage(row.payload as EmailPayload);
	await transports.sendMail(sender, { from: sender.fromAddress, to: recipient, subject, text });
}

async function deliverPush(row: ClaimedRow, transports: Transports): Promise<void> {
	const [sub] = await db()
		.select()
		.from(schema.pushSubscriptions)
		.where(and(eq(schema.pushSubscriptions.ownerId, row.owner_id), eq(schema.pushSubscriptions.endpointHash, row.destination_hash)))
		.limit(1);
	if (!sub || sub.status !== 'active') throw new AppError('DELIVERY_FAILED', 'push subscription is not active');
	const target = JSON.parse(decrypt(sub.encryptedSubscription, pushSubscriptionAad(sub.ownerId, sub.endpointHash))) as PushTarget;
	const p = row.payload as PushPayload;
	const body = JSON.stringify({ title: p.title, status: p.status, severity: p.severity, link: p.link, mutable: p.mutable });
	try {
		await transports.sendPush(target, body);
	} catch (err) {
		const status = (err as { statusCode?: number }).statusCode;
		if (status === 404 || status === 410) {
			await db()
				.update(schema.pushSubscriptions)
				.set({ status: 'expired', expiredAt: new Date() })
				.where(and(eq(schema.pushSubscriptions.id, sub.id), eq(schema.pushSubscriptions.status, 'active')));
		}
		throw err;
	}
}

export async function deliverPending(opts: { limit?: number; transports?: Transports } = {}): Promise<{ sent: number; failed: number }> {
	const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 500);
	const transports = opts.transports ?? realTransports();
	const claimed = await db().transaction(async (tx) => {
		const r = await tx.execute<ClaimedRow>(sql`
			update notifications n set status = 'sending', attempts = n.attempts + 1, claimed_at = now()
			where n.id in (
				select id from notifications where status = 'pending'
				order by created_at, id limit ${limit}
				for update skip locked)
			returning n.id, n.owner_id, n.channel, n.destination_hash, n.payload`);
		return r.rows;
	});

	let sent = 0;
	let failed = 0;
	for (const row of claimed) {
		try {
			if (row.channel === 'email') await deliverEmail(row, transports);
			else await deliverPush(row, transports);
			await db()
				.update(schema.notifications)
				.set({ status: 'sent', sentAt: new Date(), lastError: null })
				.where(and(eq(schema.notifications.id, row.id), eq(schema.notifications.status, 'sending')));
			sent += 1;
		} catch (err) {
			await db()
				.update(schema.notifications)
				.set({ status: 'delivery_failed', lastError: errorText(err) })
				.where(and(eq(schema.notifications.id, row.id), eq(schema.notifications.status, 'sending')));
			failed += 1;
		}
	}
	return { sent, failed };
}

/** Explicit user action: put one failed notification back to pending (one more attempt). */
export async function resend(ownerId: string, notificationId: string): Promise<{ id: string; status: 'pending' }> {
	if (!UUID_RE.test(notificationId)) throw new AppError('NOT_FOUND', 'not found');
	return db().transaction(async (tx) => {
		const [row] = await tx
			.select({ id: schema.notifications.id, status: schema.notifications.status })
			.from(schema.notifications)
			.where(and(eq(schema.notifications.id, notificationId), eq(schema.notifications.ownerId, ownerId)))
			.limit(1)
			.for('update');
		if (!row) throw new AppError('NOT_FOUND', 'not found');
		if (row.status !== 'delivery_failed') throw new AppError('CONFLICT', '실패한 알림만 다시 보낼 수 있음');
		await tx.update(schema.notifications).set({ status: 'pending', lastError: null }).where(eq(schema.notifications.id, row.id));
		await tx.execute(sql`select pg_notify('notify_deliver', '')`);
		return { id: row.id, status: 'pending' as const };
	});
}

/** Delivery status for the web UI (owner-scoped, no destination data). */
export async function listNotifications(ownerId: string, opts: { limit?: number; runId?: string } = {}) {
	const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 200);
	if (opts.runId !== undefined && !UUID_RE.test(opts.runId)) return [];
	const where = opts.runId
		? and(eq(schema.notifications.ownerId, ownerId), eq(schema.notifications.runId, opts.runId))
		: eq(schema.notifications.ownerId, ownerId);
	const rows = await db().select().from(schema.notifications).where(where).orderBy(desc(schema.notifications.createdAt)).limit(limit);
	return rows.map((r) => ({
		id: r.id,
		runId: r.runId,
		taskId: r.taskId,
		event: r.event,
		severity: r.severity,
		channel: r.channel,
		status: r.status,
		attempts: r.attempts,
		lastError: r.lastError,
		title: (r.payload as { title?: string }).title ?? '',
		createdAt: r.createdAt,
		sentAt: r.sentAt
	}));
}

/**
 * A crash between claim and result leaves rows in 'sending'. They are marked
 * delivery_failed (never re-sent automatically); the user can resend manually.
 */
export async function failStaleSending(olderThanSeconds = 600): Promise<number> {
	const r = await db().execute(sql`
		update notifications set status = 'delivery_failed', last_error = 'interrupted during delivery (not retried automatically)'
		where status = 'sending' and claimed_at < now() - make_interval(secs => ${olderThanSeconds})`);
	return r.rowCount ?? 0;
}
