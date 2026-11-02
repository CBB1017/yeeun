import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { useTestDatabase, createUser } from '../setup/db';

useTestDatabase();

const { db, schema, closeDb } = await import('../../src/lib/server/db');
const { storeUpload, deleteUpload, listUploads } = await import('../../src/lib/server/uploads/service');
const { createDraft, updateDraft, confirmDraft, setTaskStatus } = await import('../../src/lib/server/tasks/service');
const { createManualRun } = await import('../../src/lib/server/runs/service');
const { captureSources } = await import('../../src/lib/server/sources/capture');
const { cleanupRun } = await import('../../src/lib/server/retention/cleanup');
const h = await import('./helpers');

const root = () => process.env.FILE_STORAGE_ROOT ?? '/tmp/yeeun-test-data';

beforeAll(() => {
	process.env.FILE_STORAGE_ROOT = root();
	mkdirSync(root(), { recursive: true });
});
afterAll(async () => {
	await closeDb();
});

async function confirmedTaskFromUpload(ownerId: string, uploadIds: string[]) {
	const d = await createDraft(ownerId, '첨부한 파일에서 30일 이내 마감 과제 목록', h.TZ, uploadIds);
	const plan = structuredClone(d.plan) as Parameters<typeof updateDraft>[3] & { operations: { column: string | null }[] };
	plan.operations[0]!.column = '마감일';
	const u = await updateDraft(ownerId, d.id, d.revision, plan, false);
	expect(u.status).toBe('ready');
	const { taskId } = await confirmDraft(ownerId, d.id, u.revision);
	return taskId;
}

describe('files attached from the PC [real storage + DB, no CLI]', () => {
	it('stores an original, builds a plan from it, confirms, and a run captures the retained bytes', async () => {
		const user = await createUser();
		const bytes = await h.researchWorkbook();
		const up = await storeUpload(user.id, 'C:\\fakepath\\연구과제.xlsx', bytes);
		expect(up.skipped).toEqual([]);
		expect(up.files).toHaveLength(1);
		const f = up.files[0]!;
		expect(f.displayName).toBe('연구과제.xlsx');

		const [row] = await db().select().from(schema.uploadedOriginals).where(eq(schema.uploadedOriginals.id, f.id));
		expect(row!.relativePath).toMatch(new RegExp(`^users/${user.id}/originals/[0-9a-f-]{36}\\.xlsx$`));
		expect(Buffer.compare(await readFile(path.join(root(), row!.relativePath)), bytes)).toBe(0);

		const d = await createDraft(user.id, '30일 이내 마감 과제 목록', h.TZ, [f.id]);
		const plan = d.plan as { sources: unknown[] };
		expect(plan.sources).toEqual([
			expect.objectContaining({ upload_id: f.id, name: '연구과제.xlsx', mime_type: expect.stringContaining('spreadsheetml') })
		]);
		expect((d.plan as { unresolved_questions: { key: string }[] }).unresolved_questions.map((q) => q.key)).not.toContain('source');

		const taskId = await confirmedTaskFromUpload(user.id, [f.id]);
		const [ts] = await db().select().from(schema.taskSources).where(eq(schema.taskSources.taskId, taskId));
		expect(ts!.uploadId).toBe(f.id);
		expect(ts!.grantId).toBeNull();

		const { run } = await createManualRun(user.id, taskId, 'idem-upload-run-1');
		const cap = await captureSources({ id: run.id, ownerId: user.id, plan: run.plan });
		expect(cap.manifest.files).toHaveLength(1);
		expect(cap.manifest.files[0]!.provider_file_id).toBe(f.id);
		expect(cap.manifest.files[0]!.sha256).toBe(f.sha256);
		expect(cap.manifest.files[0]!.tables[0]!.columns.map((c) => c.label)).toContain('마감일');
		const [snap] = await db().select().from(schema.sourceSnapshots).where(eq(schema.sourceSnapshots.runId, run.id));
		expect(snap!.uploadId).toBe(f.id);
		expect(snap!.relativePath).not.toBe(row!.relativePath);

		// Completed-run cleanup removes the run snapshot only; the retained original stays.
		await db().update(schema.runs).set({ state: 'completed' }).where(eq(schema.runs.id, run.id));
		await cleanupRun(run.id);
		expect(Buffer.compare(await readFile(path.join(root(), row!.relativePath)), bytes)).toBe(0);

		// Explicit deletion is refused while a task uses it, allowed once that task is archived.
		await expect(deleteUpload(user.id, f.id)).rejects.toThrow(/쓰는 업무가 있어/);
		await setTaskStatus(user.id, taskId, 'archived');
		await deleteUpload(user.id, f.id);
		expect(await listUploads(user.id)).toEqual([]);
		await expect(readFile(path.join(root(), row!.relativePath))).rejects.toThrow();

		// A later run of the (re-activated) task reports the missing original instead of substituting anything.
		await setTaskStatus(user.id, taskId, 'active');
		const { run: run2 } = await createManualRun(user.id, taskId, 'idem-upload-run-2');
		await expect(captureSources({ id: run2.id, ownerId: user.id, plan: run2.plan })).rejects.toMatchObject({ code: 'SOURCE_MISSING' });
	});

	it('unpacks a ZIP into separate originals usable in one request', async () => {
		const user = await createUser();
		const z = new JSZip();
		z.file('2026/연구과제.xlsx', await h.researchWorkbook());
		z.file('2026/메모.txt', '지원 안 함');
		const zip = await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
		const up = await storeUpload(user.id, '자료.zip', zip);
		expect(up.files.map((f) => [f.displayName, f.archiveName])).toEqual([['2026/연구과제.xlsx', '자료.zip']]);
		expect(up.skipped).toEqual([{ name: '2026/메모.txt', reason: 'unsupported' }]);
		const taskId = await confirmedTaskFromUpload(user.id, up.files.map((f) => f.id));
		expect(taskId).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("never lets a user use or delete another user's upload", async () => {
		const owner = await createUser();
		const other = await createUser();
		const up = await storeUpload(owner.id, 'a.csv', Buffer.from('이름,마감일\n가,2026-11-30\n'));
		const id = up.files[0]!.id;
		await expect(createDraft(other.id, '목록', h.TZ, [id])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
		await expect(deleteUpload(other.id, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
		expect(await listUploads(other.id)).toEqual([]);
		// Editing a plan to point at someone else's upload is refused too.
		const d = await createDraft(other.id, '목록', h.TZ);
		const plan = structuredClone(d.plan) as { sources: unknown[] };
		plan.sources = [{ upload_id: id, name: 'x', mime_type: 'text/csv', selector: (await import('../../src/lib/shared/plan')).defaultSelector() }];
		await expect(updateDraft(other.id, d.id, d.revision, plan, false)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
	});

	it('detects a retained original whose bytes changed on disk', async () => {
		const user = await createUser();
		const up = await storeUpload(user.id, 'b.csv', Buffer.from('이름,마감일\n가,2026-11-30\n'));
		const id = up.files[0]!.id;
		const taskId = await confirmedTaskFromUpload(user.id, [id]);
		const [row] = await db()
			.select()
			.from(schema.uploadedOriginals)
			.where(and(eq(schema.uploadedOriginals.id, id), eq(schema.uploadedOriginals.ownerId, user.id)));
		await writeFile(path.join(root(), row!.relativePath), '이름,마감일\n바뀜,2026-12-01\n');
		const { run } = await createManualRun(user.id, taskId, 'idem-upload-tamper');
		await expect(captureSources({ id: run.id, ownerId: user.id, plan: run.plan })).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
	});

	it('rejects a renamed binary and an unsupported type before storing anything', async () => {
		const user = await createUser();
		await expect(storeUpload(user.id, 'x.xlsx', Buffer.from('plain text'))).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
		await expect(storeUpload(user.id, 'x.hwp', Buffer.from('x'))).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
		const rows = await db().select().from(schema.uploadedOriginals).where(eq(schema.uploadedOriginals.ownerId, user.id));
		expect(rows).toEqual([]);
	});
});
