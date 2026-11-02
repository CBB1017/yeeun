import { and, eq, sql } from 'drizzle-orm';
import path from 'node:path';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { db, schema } from './db';
import { AppError } from './errors';
import { probeWritable, resolveInsideRoot } from './storage';

/**
 * Storage roots. The web app cannot mount host paths (no Docker socket): a new
 * host path is recorded as pending_mount with operator instructions until a
 * container path for it is actually mounted and writable.
 */

export async function listRoots() {
	const roots = await db().select().from(schema.storageRoots).orderBy(schema.storageRoots.createdAt);
	const counts = await db().execute<{ storage_root_id: string; n: number }>(
		sql`select storage_root_id, count(*)::int n from (select storage_root_id from artifacts union all select storage_root_id from retained_copies union all select storage_root_id from source_snapshots where status <> 'deleted') x group by storage_root_id`
	);
	return roots.map((r) => ({ ...r, references: counts.rows.find((c) => c.storage_root_id === r.id)?.n ?? 0 }));
}

export async function requestRoot(adminId: string, hostLabel: string, containerPath: string) {
	if (!path.posix.isAbsolute(containerPath) || containerPath.includes('..') || !/^\/[A-Za-z0-9/_-]+$/.test(containerPath)) {
		throw new AppError('VALIDATION_FAILED', '컨테이너 경로는 /로 시작하는 단순 절대경로여야 합니다');
	}
	const [row] = await db()
		.insert(schema.storageRoots)
		.values({ label: hostLabel.slice(0, 200), hostLabel: hostLabel.slice(0, 500), containerPath, status: 'pending_mount' })
		.returning();
	await db()
		.insert(schema.auditEvents)
		.values({ actorId: adminId, action: 'storage_root.requested', resourceType: 'storage_root', resourceId: row!.id, meta: {} });
	return {
		root: row!,
		operator_action: `호스트 경로를 컨테이너 ${containerPath}에 마운트하도록 compose.yaml(web/worker/migrate의 volumes)을 수정하고 'docker compose up -d --wait'로 재생성한 뒤 '적용'을 누르세요. 앱은 Docker를 제어하지 않습니다.`
	};
}

/** Activate a pending root only if it is really mounted & writable; existing files keep their old root reference. */
export async function activateRoot(adminId: string, id: string) {
	const [r] = await db().select().from(schema.storageRoots).where(eq(schema.storageRoots.id, id)).limit(1);
	if (!r) throw new AppError('NOT_FOUND', 'not found');
	if (!(await probeWritable(r.containerPath)))
		throw new AppError('CONFLICT', `${r.containerPath}가 마운트되지 않았거나 쓸 수 없음 (operator_action_required)`);
	await db().transaction(async (tx) => {
		await tx.update(schema.storageRoots).set({ status: 'retired' }).where(eq(schema.storageRoots.status, 'active'));
		await tx.update(schema.storageRoots).set({ status: 'active', activatedAt: new Date() }).where(eq(schema.storageRoots.id, id));
		await tx
			.insert(schema.auditEvents)
			.values({ actorId: adminId, action: 'storage_root.activated', resourceType: 'storage_root', resourceId: id, meta: {} });
	});
	// Old roots stay readable (status retired) — references are resolved per row.
	const [old] = await db()
		.select()
		.from(schema.storageRoots)
		.where(and(eq(schema.storageRoots.status, 'retired')))
		.limit(1);
	return { activated: true, previous: old?.id ?? null };
}

/** Explicit migration of retained files: copy -> verify hash -> update DB reference. Old files are not deleted here. */
export async function migrateFiles(adminId: string, fromRootId: string, toRootId: string) {
	const [from] = await db().select().from(schema.storageRoots).where(eq(schema.storageRoots.id, fromRootId));
	const [to] = await db().select().from(schema.storageRoots).where(eq(schema.storageRoots.id, toRootId));
	if (!from || !to || to.status !== 'active') throw new AppError('VALIDATION_FAILED', '대상 루트가 활성 상태여야 합니다');
	let moved = 0;
	for (const table of [schema.artifacts, schema.retainedCopies] as const) {
		const rows = await db().select().from(table).where(eq(table.storageRootId, fromRootId));
		for (const row of rows) {
			const src = await resolveInsideRoot(from.containerPath, row.relativePath);
			const dst = path.join(to.containerPath, ...row.relativePath.split('/'));
			await mkdir(path.dirname(dst), { recursive: true });
			await copyFile(src, dst);
			const h = createHash('sha256')
				.update(await readFile(dst))
				.digest('hex');
			if (h !== row.sha256) throw new AppError('STORAGE_FAILED', `hash 불일치로 이전 중단: ${row.id}`);
			await db().update(table).set({ storageRootId: toRootId }).where(eq(table.id, row.id));
			moved++;
		}
	}
	await db()
		.insert(schema.auditEvents)
		.values({ actorId: adminId, action: 'storage_root.migrated', resourceType: 'storage_root', resourceId: toRootId, meta: { moved } });
	return { moved, note: '이전 루트의 원본 파일은 별도 확인 후 운영자가 삭제합니다.' };
}
