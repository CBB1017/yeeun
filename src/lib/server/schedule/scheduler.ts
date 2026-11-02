import { and, eq, lte, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { appendEvent } from '../runs/events';
import { nextOccurrence, occurrencesBetween, planDue } from './rules';
import type { ScheduleRule, TaskPlan } from '../../shared/plan';

/**
 * Scheduler tick. For each active schedule, all occurrences due since the
 * watermark coalesce into one run (unique per task/revision/scheduled_for),
 * so restarts and repeated ticks never enqueue duplicates.
 */
export async function schedulerTick(now = new Date()): Promise<{ created: number }> {
	const due = await db()
		.select()
		.from(schema.schedules)
		.where(and(eq(schema.schedules.active, true), lte(schema.schedules.nextDueAt, now)));
	let created = 0;
	for (const s of due) {
		created += await db().transaction(async (tx) => {
			const locked = await tx.execute<{ watermark_at: Date; revision: number; active: boolean }>(
				sql`select watermark_at, revision, active from schedules where id = ${s.id} for update`
			);
			const cur = locked.rows[0];
			if (!cur || !cur.active || cur.revision !== s.revision) return 0;
			const rule = s.rule as ScheduleRule;
			const occ = occurrencesBetween(rule, s.timezone, new Date(cur.watermark_at), now);
			const plan = planDue(occ, now);
			const next = nextOccurrence(rule, s.timezone, now);
			await tx.update(schema.schedules).set({ watermarkAt: now, nextDueAt: next, updatedAt: now }).where(eq(schema.schedules.id, s.id));
			if (!plan) return 0;
			const [task] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, s.taskId)).limit(1);
			if (!task || task.status !== 'active') return 0;
			const [o] = await tx
				.insert(schema.scheduleOccurrences)
				.values({
					scheduleId: s.id,
					taskId: s.taskId,
					scheduleRevision: s.revision,
					scheduledFor: plan.representative,
					kind: plan.kind,
					missedFrom: plan.missedFrom,
					missedTo: plan.missedTo,
					missedCount: plan.missedCount
				})
				.onConflictDoNothing()
				.returning();
			if (!o) return 0;
			const [run] = await tx
				.insert(schema.runs)
				.values({
					ownerId: task.ownerId,
					taskId: task.id,
					trigger: plan.kind === 'catch_up' ? 'catch_up' : 'schedule',
					occurrenceId: o.id,
					planRevision: task.planRevision,
					plan: task.plan as TaskPlan,
					late: plan.kind === 'catch_up',
					eligibleAt: now
				})
				.onConflictDoNothing()
				.returning();
			if (!run) return 0;
			await tx.update(schema.scheduleOccurrences).set({ runId: run.id }).where(eq(schema.scheduleOccurrences.id, o.id));
			await appendEvent(tx, run, 'queued', {
				trigger: run.trigger,
				scheduled_for: plan.representative.toISOString(),
				missed_count: plan.missedCount
			});
			await tx.execute(sql`select pg_notify('run_dispatch', '')`);
			return 1;
		});
	}
	return { created };
}
