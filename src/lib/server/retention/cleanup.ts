import { and, eq, inArray } from 'drizzle-orm';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { db, schema } from '../db';
import { deleteRetained, rootById, runRelativeDir } from '../storage';
import { redact } from '../errors';

/**
 * After a run is completed, delete only raw material: captured source bytes,
 * the full extraction manifest and work files. Results, downloads, version
 * metadata and evidence excerpts are kept with no automatic expiry. Runs in
 * error/review states are never cleaned. Idempotent; a failure only leaves
 * rows in deletion_pending for the next cleanup attempt (never an analysis rerun).
 */
export async function cleanupRun(runId: string): Promise<{ deleted: number; pending: number }> {
	const [run] = await db().select().from(schema.runs).where(eq(schema.runs.id, runId)).limit(1);
	if (!run || run.state !== 'completed') return { deleted: 0, pending: 0 };
	await db()
		.update(schema.sourceSnapshots)
		.set({ status: 'deletion_pending' })
		.where(and(eq(schema.sourceSnapshots.runId, runId), eq(schema.sourceSnapshots.status, 'active')));
	const snaps = await db()
		.select()
		.from(schema.sourceSnapshots)
		.where(and(eq(schema.sourceSnapshots.runId, runId), eq(schema.sourceSnapshots.status, 'deletion_pending')));
	let deleted = 0;
	let pending = 0;
	for (const s of snaps) {
		try {
			await deleteRetained(s.storageRootId, s.relativePath);
			await db()
				.update(schema.sourceSnapshots)
				.set({ status: 'deleted', deletedAt: new Date() })
				.where(eq(schema.sourceSnapshots.id, s.id));
			deleted++;
		} catch (e) {
			pending++;
			console.error('[cleanup] snapshot delete failed; will retry cleanup only', redact((e as Error).message));
		}
	}
	const manifests = await db()
		.select()
		.from(schema.retainedCopies)
		.where(and(eq(schema.retainedCopies.runId, runId), inArray(schema.retainedCopies.kind, ['manifest'])));
	for (const m of manifests) {
		try {
			await deleteRetained(m.storageRootId, m.relativePath);
			await db().delete(schema.retainedCopies).where(eq(schema.retainedCopies.id, m.id));
		} catch (e) {
			pending++;
			console.error('[cleanup] manifest delete failed', redact((e as Error).message));
		}
	}
	// Work area (CLI temp sessions live in the cli-runner tmpfs and are removed per invocation).
	if (snaps[0]) {
		const root = await rootById(snaps[0].storageRootId);
		await rm(path.join(root.containerPath, ...runRelativeDir(run.ownerId, run.id, 'work').split('/')), {
			recursive: true,
			force: true
		}).catch(() => {});
	}
	return { deleted, pending };
}

/** Retry any cleanup left pending (e.g. after a disk error). */
export async function cleanupPending(): Promise<number> {
	const rows = await db()
		.selectDistinct({ runId: schema.sourceSnapshots.runId })
		.from(schema.sourceSnapshots)
		.innerJoin(schema.runs, eq(schema.runs.id, schema.sourceSnapshots.runId))
		.where(and(eq(schema.runs.state, 'completed'), inArray(schema.sourceSnapshots.status, ['active', 'deletion_pending'])));
	for (const r of rows) await cleanupRun(r.runId);
	return rows.length;
}
