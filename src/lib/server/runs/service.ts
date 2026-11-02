import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema, type DbOrTx } from '../db';
import { AppError } from '../errors';
import { appendEvent } from './events';
import type { RunState } from '../db/schema';
import type { TaskPlan } from '../../shared/plan';

/** User-facing run operations. All functions are owner-scoped. */

export const NONTERMINAL: RunState[] = ['queued', 'preparing', 'executing', 'comparing', 'finalizing', 'awaiting_review', 'review_queued'];

export async function getOwnedRun(ownerId: string, runId: string, tx: DbOrTx = db()) {
	if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new AppError('NOT_FOUND', 'not found');
	const [run] = await tx
		.select()
		.from(schema.runs)
		.where(and(eq(schema.runs.id, runId), eq(schema.runs.ownerId, ownerId)))
		.limit(1);
	if (!run) throw new AppError('NOT_FOUND', 'not found');
	return run;
}

export async function nudgeDispatcher(tx: DbOrTx = db()) {
	await tx.execute(sql`select pg_notify('run_dispatch', '')`);
}

/** Explicit user-requested run (new run, never a retry of a failed one). */
export async function createManualRun(ownerId: string, taskId: string, idempotencyKey: string | null) {
	return db().transaction(async (tx) => {
		if (idempotencyKey) {
			const [dup] = await tx
				.select()
				.from(schema.runs)
				.where(and(eq(schema.runs.ownerId, ownerId), eq(schema.runs.idempotencyKey, idempotencyKey)))
				.limit(1);
			if (dup) return { run: dup, duplicate: true };
		}
		const [task] = await tx
			.select()
			.from(schema.tasks)
			.where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.ownerId, ownerId)))
			.limit(1);
		if (!task) throw new AppError('NOT_FOUND', 'not found');
		if (task.status === 'archived') throw new AppError('CONFLICT', '보관된 업무는 실행할 수 없음');
		const [run] = await tx
			.insert(schema.runs)
			.values({
				ownerId,
				taskId,
				trigger: 'manual',
				planRevision: task.planRevision,
				plan: task.plan as TaskPlan,
				idempotencyKey
			})
			.onConflictDoNothing()
			.returning();
		if (!run) {
			const [dup] = await tx
				.select()
				.from(schema.runs)
				.where(and(eq(schema.runs.ownerId, ownerId), eq(schema.runs.idempotencyKey, idempotencyKey!)))
				.limit(1);
			return { run: dup!, duplicate: true };
		}
		await appendEvent(tx, run, 'queued', { trigger: 'manual' });
		await nudgeDispatcher(tx);
		return { run, duplicate: false };
	});
}

/**
 * Second-round review after the first disagreement. Exactly one transition
 * awaiting_review(round 1) -> review_queued(round 2) is possible; duplicate
 * clicks hit the conditional update and enqueue nothing.
 */
export async function requestReview(ownerId: string, runId: string) {
	return db().transaction(async (tx) => {
		const updated = await tx
			.update(schema.runs)
			.set({ state: 'review_queued', round: 2, reviewRequestedAt: new Date(), eligibleAt: new Date(), updatedAt: new Date() })
			.where(
				and(eq(schema.runs.id, runId), eq(schema.runs.ownerId, ownerId), eq(schema.runs.state, 'awaiting_review'), eq(schema.runs.round, 1))
			)
			.returning();
		if (updated[0]) {
			await appendEvent(tx, updated[0], 'review_requested', { round: 2 });
			await nudgeDispatcher(tx);
			return { run: updated[0], duplicate: false };
		}
		const run = await getOwnedRun(ownerId, runId, tx);
		if (run.round === 2 && run.reviewRequestedAt) return { run, duplicate: true };
		throw new AppError('CONFLICT', '재검토는 첫 불일치 상태에서 한 번만 요청할 수 있음');
	});
}

export async function cancelRun(ownerId: string, runId: string) {
	return db().transaction(async (tx) => {
		const run = await getOwnedRun(ownerId, runId, tx);
		if (['queued', 'review_queued', 'awaiting_review'].includes(run.state)) {
			const [u] = await tx
				.update(schema.runs)
				.set({
					state: 'cancelled',
					errorCode: 'CANCELLED',
					errorStage: run.state,
					finishedAt: new Date(),
					cancelRequestedAt: new Date(),
					retentionStatus: run.state === 'awaiting_review' ? 'retained' : run.retentionStatus,
					updatedAt: new Date()
				})
				.where(and(eq(schema.runs.id, runId), inArray(schema.runs.state, ['queued', 'review_queued', 'awaiting_review'])))
				.returning();
			if (u) {
				await appendEvent(tx, u, 'cancelled', { from: run.state });
				await nudgeDispatcher(tx);
				return u;
			}
		}
		if (['preparing', 'executing', 'comparing', 'finalizing'].includes(run.state)) {
			const [u] = await tx
				.update(schema.runs)
				.set({ cancelRequestedAt: new Date(), updatedAt: new Date() })
				.where(eq(schema.runs.id, runId))
				.returning();
			await appendEvent(tx, u!, 'cancel_requested', {});
			return u!;
		}
		return run;
	});
}

/** Reviewer for a user: initial Claude; flipped only by a successful completion. */
export async function currentReviewer(ownerId: string, tx: DbOrTx = db()): Promise<'claude' | 'codex'> {
	await tx.insert(schema.reviewerState).values({ ownerId }).onConflictDoNothing();
	const [s] = await tx.select().from(schema.reviewerState).where(eq(schema.reviewerState.ownerId, ownerId));
	return (s?.nextProvider as 'claude' | 'codex') ?? 'claude';
}

/**
 * Advance the user's round robin exactly once for this run, inside the
 * completion transaction (row lock + last_advanced_run_id guard).
 */
export async function advanceReviewer(tx: DbOrTx, ownerId: string, runId: string, usedReviewer: 'claude' | 'codex') {
	await tx.insert(schema.reviewerState).values({ ownerId }).onConflictDoNothing();
	const r = await tx.execute<{ next_provider: string; last_advanced_run_id: string | null }>(
		sql`select next_provider, last_advanced_run_id from reviewer_state where owner_id = ${ownerId} for update`
	);
	const row = r.rows[0]!;
	if (row.last_advanced_run_id === runId) return false;
	const next = usedReviewer === 'claude' ? 'codex' : 'claude';
	await tx
		.update(schema.reviewerState)
		.set({ nextProvider: next, revision: sql`${schema.reviewerState.revision} + 1`, lastAdvancedRunId: runId, updatedAt: new Date() })
		.where(eq(schema.reviewerState.ownerId, ownerId));
	return true;
}
