import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { config } from '../config';
import { appendEvent } from '../runs/events';
import { currentReviewer } from '../runs/service';
import { enqueueNotifications } from '../notify/outbox';

/**
 * Run claiming. The `runs` table is the authoritative queue:
 *  - FIFO by (eligible_at, created_at, id)
 *  - a user's lane is held by any of their nonterminal runs (including
 *    awaiting_review); only the user's oldest nonterminal run may start
 *  - at most TASK_CONCURRENCY runs are active globally
 * awaiting_review frees the global slot but keeps the user's lane.
 */

export interface Claimed {
	id: string;
	ownerId: string;
	round: number;
}

export async function claimNext(workerId: string, now = new Date()): Promise<Claimed | null> {
	const cfg = config();
	return db().transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(727002)`);
		const active = await tx.execute<{ n: number }>(
			sql`select count(*)::int as n from runs where state in ('preparing','executing','comparing','finalizing')`
		);
		if (active.rows[0]!.n >= cfg.taskConcurrency) return null;
		const cand = await tx.execute<{ id: string; owner_id: string; round: number; state: string }>(sql`
			select r.id, r.owner_id, r.round, r.state from runs r
			where r.state in ('queued','review_queued') and r.eligible_at <= ${now}
			  and not exists (
				select 1 from runs o where o.owner_id = r.owner_id and o.id <> r.id
				  and (
					o.state in ('preparing','executing','comparing','finalizing')
					or (o.state in ('queued','review_queued','awaiting_review') and (o.created_at, o.id) < (r.created_at, r.id))
				  ))
			order by r.eligible_at, r.created_at, r.id
			limit 1
			for update of r skip locked`);
		const c = cand.rows[0];
		if (!c) return null;
		const reviewer = c.round === 1 ? await currentReviewer(c.owner_id, tx) : undefined;
		const lease = new Date(now.getTime() + cfg.leaseSeconds * 1000);
		const [u] = await tx
			.update(schema.runs)
			.set({
				state: c.round === 1 ? 'preparing' : 'executing',
				leaseOwner: workerId,
				leaseExpiresAt: lease,
				heartbeatAt: now,
				startedAt: c.round === 1 ? now : sql`coalesce(${schema.runs.startedAt}, ${now})`,
				...(reviewer ? { reviewerProvider: reviewer } : {}),
				updatedAt: now
			})
			.where(and(eq(schema.runs.id, c.id), inArray(schema.runs.state, ['queued', 'review_queued'])))
			.returning();
		if (!u) return null;
		await appendEvent(tx, u, 'claimed', { round: u.round, reviewer: u.reviewerProvider });
		return { id: u.id, ownerId: u.ownerId, round: u.round };
	});
}

/** Extend leases of runs this worker holds; returns runs whose cancel was requested. */
export async function heartbeat(workerId: string, runIds: string[]): Promise<{ cancelled: string[] }> {
	if (!runIds.length) return { cancelled: [] };
	const lease = new Date(Date.now() + config().leaseSeconds * 1000);
	const rows = await db()
		.update(schema.runs)
		.set({ heartbeatAt: new Date(), leaseExpiresAt: lease })
		.where(and(inArray(schema.runs.id, runIds), eq(schema.runs.leaseOwner, workerId)))
		.returning({ id: schema.runs.id, cancel: schema.runs.cancelRequestedAt });
	return { cancelled: rows.filter((r) => r.cancel).map((r) => r.id) };
}

/**
 * Active runs whose lease expired (worker died / PC stopped) become
 * `interrupted`. They are never re-executed automatically.
 */
export async function recoverInterrupted(now = new Date()): Promise<string[]> {
	return db().transaction(async (tx) => {
		const rows = await tx
			.update(schema.runs)
			.set({
				state: 'interrupted',
				errorCode: 'INTERRUPTED',
				errorStage: sql`${schema.runs.state}`,
				errorMessage: '작업자 중단으로 실행이 끊김 (자동 재실행 안 함)',
				finishedAt: now,
				retentionStatus: 'retained',
				leaseOwner: null,
				updatedAt: now
			})
			.where(and(inArray(schema.runs.state, ['preparing', 'executing', 'comparing', 'finalizing']), lt(schema.runs.leaseExpiresAt, now)))
			.returning();
		for (const r of rows) {
			await tx
				.update(schema.cliExecutions)
				.set({ status: 'interrupted', errorCode: 'INTERRUPTED', finishedAt: now })
				.where(and(eq(schema.cliExecutions.runId, r.id), eq(schema.cliExecutions.status, 'running')));
			await appendEvent(tx, r, 'state:interrupted', {});
			await enqueueNotifications(tx, {
				ownerId: r.ownerId,
				runId: r.id,
				taskId: r.taskId,
				event: 'error',
				severity: 'error',
				title: '업무 실행 중단됨',
				body: '작업자/PC 중단으로 실행이 중단되었습니다. 자동으로 다시 실행하지 않습니다. 필요하면 새로 실행하세요.',
				link: `${config().publicOrigin}/runs/${r.id}`
			});
		}
		return rows.map((r) => r.id);
	});
}
