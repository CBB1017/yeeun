import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { AppError, redact } from '../errors';
import { readRetained } from '../storage';
import { accessTokenFor, uploadNewFile } from '../drive/google';
import { hashJson, sha256Hex } from '../crypto';

/**
 * External transmission of generated copies. Approval binds the exact artifact
 * hash + destination + action shown to the user, is single-use, and is
 * invalidated if either changes. Originals are never written.
 */

export function approvalHash(a: { artifactSha256: string; destinationHash: string; action: string }) {
	return hashJson({ artifact: a.artifactSha256, destination: a.destinationHash, action: a.action });
}

export async function listActions(ownerId: string, runId: string) {
	return db()
		.select()
		.from(schema.externalActions)
		.where(and(eq(schema.externalActions.ownerId, ownerId), eq(schema.externalActions.runId, runId)));
}

async function owned(ownerId: string, id: string) {
	if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('NOT_FOUND', 'not found');
	const [a] = await db()
		.select()
		.from(schema.externalActions)
		.where(and(eq(schema.externalActions.id, id), eq(schema.externalActions.ownerId, ownerId)))
		.limit(1);
	if (!a) throw new AppError('NOT_FOUND', 'not found');
	return a;
}

/** `confirmedHash` is the approval hash the UI displayed; any change requires re-approval. */
export async function approveAction(ownerId: string, id: string, confirmedHash: string) {
	const a = await owned(ownerId, id);
	const [art] = await db().select().from(schema.artifacts).where(eq(schema.artifacts.id, a.artifactId)).limit(1);
	if (!art || art.sha256 !== a.artifactSha256) {
		await db().update(schema.externalActions).set({ status: 'invalidated' }).where(eq(schema.externalActions.id, id));
		throw new AppError('CONFLICT', '파일이 변경되어 승인이 무효화됨 — 다시 확인하세요');
	}
	const expected = approvalHash(a);
	if (confirmedHash !== expected) throw new AppError('CONFLICT', '확인한 파일/대상이 현재와 다름 — 다시 확인하세요');
	const [u] = await db()
		.update(schema.externalActions)
		.set({
			status: 'approved',
			approvedHash: expected,
			approvedAt: new Date(),
			approvalRevision: sql`${schema.externalActions.approvalRevision} + 1`
		})
		.where(and(eq(schema.externalActions.id, id), eq(schema.externalActions.status, 'pending')))
		.returning();
	if (!u) {
		if (a.status === 'approved' || a.status === 'executing' || a.status === 'executed') return a; // duplicate click
		throw new AppError('CONFLICT', `현재 상태(${a.status})에서는 승인할 수 없음`);
	}
	await db().execute(sql`select pg_notify('external_action', ${id})`);
	return u;
}

export async function rejectAction(ownerId: string, id: string) {
	await owned(ownerId, id);
	const [u] = await db()
		.update(schema.externalActions)
		.set({ status: 'rejected' })
		.where(and(eq(schema.externalActions.id, id), eq(schema.externalActions.status, 'pending')))
		.returning();
	if (!u) throw new AppError('CONFLICT', '대기 중인 요청만 거부할 수 있음');
	return u;
}

/** Worker: execute approved actions exactly once (approved -> executing is a conditional claim). */
export async function executeApprovedActions(): Promise<number> {
	const pending = await db().select().from(schema.externalActions).where(eq(schema.externalActions.status, 'approved'));
	let done = 0;
	for (const a of pending) {
		const [claimed] = await db()
			.update(schema.externalActions)
			.set({ status: 'executing' })
			.where(and(eq(schema.externalActions.id, a.id), eq(schema.externalActions.status, 'approved')))
			.returning();
		if (!claimed) continue;
		try {
			const [art] = await db().select().from(schema.artifacts).where(eq(schema.artifacts.id, a.artifactId)).limit(1);
			const bytes = art ? await readRetained(art.storageRootId, art.relativePath) : null;
			if (!art || !bytes || sha256Hex(bytes) !== a.artifactSha256 || approvalHash(a) !== a.approvedHash) {
				await db()
					.update(schema.externalActions)
					.set({ status: 'invalidated', lastError: '파일 또는 대상이 승인 후 변경됨' })
					.where(eq(schema.externalActions.id, a.id));
				continue;
			}
			const { token } = await accessTokenFor(a.ownerId);
			const meta = await uploadNewFile(token, art.filename, art.mimeType, bytes);
			await db()
				.update(schema.externalActions)
				.set({ status: 'executed', executedAt: new Date(), resultRef: meta.id })
				.where(eq(schema.externalActions.id, a.id));
			done++;
		} catch (e) {
			await db()
				.update(schema.externalActions)
				.set({ status: 'failed', lastError: redact((e as Error).message) })
				.where(eq(schema.externalActions.id, a.id));
		}
	}
	return done;
}
