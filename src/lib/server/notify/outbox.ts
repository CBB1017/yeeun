import { and, eq, gt, sql } from 'drizzle-orm';
import { config } from '../config';
import { sha256Hex } from '../crypto';
import { schema, type DbOrTx } from '../db';
import { buildEmailPayload, toPushPayload, type NotifyEvent, type NotifySeverity } from './payload';

export interface EnqueueEvent {
	ownerId: string;
	runId: string | null;
	taskId: string | null;
	event: NotifyEvent;
	severity: NotifySeverity;
	title: string;
	body: string;
	link: string;
}

export interface EnqueueOptions {
	/** Clock used for the mute check (tests). Defaults to the current time. */
	now?: Date;
	/**
	 * Extra discriminator appended to the event key. Needed only for events
	 * without a run (runId null), e.g. repeated user-initiated test messages,
	 * which would otherwise be deduplicated as `none:<event>`.
	 */
	eventKeySuffix?: string;
}

/** Owner-scoped hash of a recipient address (never store the address in the outbox). */
export function emailDestinationHash(ownerId: string, recipient: string): string {
	return sha256Hex(`email:${ownerId}:${recipient.trim().toLowerCase()}`);
}

export function pushSubscriptionAad(ownerId: string, endpointHash: string): string {
	return `push:${ownerId}:${endpointHash}`;
}

export function eventKeyFor(runId: string | null, event: NotifyEvent, suffix?: string): string {
	return `${runId ?? 'none'}:${event}${suffix ? `:${suffix}` : ''}`;
}

/**
 * Transactional outbox. Call INSIDE the caller's completion/error transaction
 * so notifications commit atomically with the run state.
 *
 * - One row per enabled channel + destination: email only when enabled with a
 *   verified recipient; push one row per active subscription when enabled.
 *   A disabled channel is never enabled implicitly and there is no fallback
 *   from one channel to the other.
 * - Idempotent through unique (event_key, channel, destination_hash).
 * - Normal notifications of a task muted until a future time are recorded as
 *   'suppressed'; error severity is never suppressed.
 *
 * Returns `created` = new pending rows, `suppressed` = new suppressed rows.
 */
export async function enqueueNotifications(
	tx: DbOrTx,
	e: EnqueueEvent,
	opts: EnqueueOptions = {}
): Promise<{ created: number; suppressed: number }> {
	const now = opts.now ?? new Date();
	const [settings] = await tx.select().from(schema.notificationSettings).where(eq(schema.notificationSettings.ownerId, e.ownerId)).limit(1);
	if (!settings || (!settings.emailEnabled && !settings.pushEnabled)) return { created: 0, suppressed: 0 };

	let muted = false;
	if (e.severity === 'normal' && e.taskId) {
		const [m] = await tx
			.select({ id: schema.muteRules.id })
			.from(schema.muteRules)
			.where(and(eq(schema.muteRules.ownerId, e.ownerId), eq(schema.muteRules.taskId, e.taskId), gt(schema.muteRules.muteUntil, now)))
			.limit(1);
		muted = !!m;
	}
	const status = muted ? 'suppressed' : 'pending';
	const eventKey = eventKeyFor(e.runId, e.event, opts.eventKeySuffix);
	const emailPayload = buildEmailPayload(e, config().publicOrigin);
	const base = {
		ownerId: e.ownerId,
		runId: e.runId,
		taskId: e.taskId,
		eventKey,
		event: e.event,
		severity: e.severity,
		status
	};

	const rows: (typeof schema.notifications.$inferInsert)[] = [];
	if (settings.emailEnabled && settings.recipientEmail && settings.recipientVerifiedAt) {
		rows.push({
			...base,
			channel: 'email',
			destinationHash: emailDestinationHash(e.ownerId, settings.recipientEmail),
			payload: emailPayload
		});
	}
	if (settings.pushEnabled) {
		const subs = await tx
			.select({ endpointHash: schema.pushSubscriptions.endpointHash })
			.from(schema.pushSubscriptions)
			.where(and(eq(schema.pushSubscriptions.ownerId, e.ownerId), eq(schema.pushSubscriptions.status, 'active')));
		const pushPayload = toPushPayload(emailPayload);
		for (const s of subs) {
			rows.push({ ...base, channel: 'push', destinationHash: s.endpointHash, payload: pushPayload });
		}
	}
	if (rows.length === 0) return { created: 0, suppressed: 0 };

	const inserted = await tx
		.insert(schema.notifications)
		.values(rows)
		.onConflictDoNothing()
		.returning({ status: schema.notifications.status });
	const created = inserted.filter((r) => r.status === 'pending').length;
	const suppressed = inserted.length - created;
	if (created > 0) await tx.execute(sql`select pg_notify('notify_deliver', '')`);
	return { created, suppressed };
}
