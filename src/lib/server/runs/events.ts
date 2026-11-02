import { sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../db';

/** Append-only run event log with per-run sequence numbers (SSE replay cursor). */
export async function appendEvent(
	tx: DbOrTx,
	run: { id: string; ownerId: string },
	type: string,
	data: Record<string, unknown> = {}
): Promise<number> {
	// Serialize per run so concurrent writers (two CLIs finishing together) never race on seq.
	await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${run.id}, 727))`);
	const r = await tx.execute<{ seq: number }>(sql`
		insert into run_events (run_id, owner_id, seq, type, data)
		values (${run.id}, ${run.ownerId},
			(select coalesce(max(seq), 0) + 1 from run_events where run_id = ${run.id}),
			${type}, ${JSON.stringify(data)}::jsonb)
		returning seq`);
	const seq = r.rows[0]!.seq;
	// Wake SSE listeners (payload carries ids only, no content).
	await tx.execute(sql`select pg_notify('run_events', ${JSON.stringify({ run_id: run.id, owner_id: run.ownerId, seq })})`);
	return seq;
}

export async function eventsSince(runId: string, ownerId: string, afterSeq: number) {
	const r = await db().execute<{ seq: number; type: string; data: unknown; created_at: Date }>(sql`
		select seq, type, data, created_at from run_events
		where run_id = ${runId} and owner_id = ${ownerId} and seq > ${afterSeq}
		order by seq asc limit 500`);
	return r.rows;
}
