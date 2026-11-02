import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db, schema } from '../db';
import { config } from '../config';
import { AppError } from '../errors';
import { deleteRetained, ensureActiveRoot, generatedName, originalsRelativeDir, readRetained, writeFileAtomic } from '../storage';
import { MAX_ATTACHMENTS, UPLOAD_EXTENSIONS, extensionOf, type UploadLimits, type UploadResult, type UploadedOriginal } from '../../shared/uploads';
import { acceptSingle, cleanDisplayName, unpackZip, type AcceptedFile } from './inspect';

/**
 * Files attached from the user's PC become immutable, owner-scoped task
 * originals under users/<uuid>/originals/. They are kept for reruns and
 * schedules until the user deletes them; run cleanup never removes them.
 */

export function uploadLimits(): UploadLimits {
	const cfg = config();
	return {
		maxFileBytes: cfg.maxSourceFileBytes,
		maxArchiveTotalBytes: cfg.maxRunSourceBytes,
		maxAttachments: MAX_ATTACHMENTS,
		extensions: UPLOAD_EXTENSIONS
	};
}

type Row = typeof schema.uploadedOriginals.$inferSelect;

export function publicUpload(r: Row): UploadedOriginal {
	return {
		id: r.id,
		displayName: r.displayName,
		mimeType: r.mimeType,
		sizeBytes: r.sizeBytes,
		sha256: r.sha256,
		archiveName: r.archiveName,
		createdAt: r.createdAt.toISOString()
	};
}

/** Validate (and unpack a ZIP), then store every accepted file atomically with its sha256. */
export async function storeUpload(ownerId: string, rawName: string, bytes: Buffer): Promise<UploadResult> {
	const limits = uploadLimits();
	const name = cleanDisplayName(rawName);
	let accepted: AcceptedFile[];
	let skipped: UploadResult['skipped'] = [];
	if (extensionOf(name) === 'zip') {
		if (bytes.length > limits.maxFileBytes) throw new AppError('SOURCE_TOO_LARGE', `"${name}"이(가) 파일 크기 한도를 넘습니다`);
		const z = await unpackZip(name, bytes, {
			maxFileBytes: limits.maxFileBytes,
			maxTotalBytes: limits.maxArchiveTotalBytes,
			maxFiles: limits.maxAttachments
		});
		accepted = z.files;
		skipped = z.skipped;
	} else {
		accepted = [acceptSingle(name, bytes, limits.maxFileBytes)];
	}

	const root = await ensureActiveRoot();
	const dir = originalsRelativeDir(ownerId);
	const written: { file: AcceptedFile; relativePath: string; sha256: string; size: number }[] = [];
	try {
		for (const f of accepted) {
			const w = await writeFileAtomic(root, dir, generatedName(f.ext), f.bytes);
			written.push({ file: f, relativePath: w.relativePath, sha256: w.sha256, size: w.sizeBytes });
		}
		const rows = await db()
			.insert(schema.uploadedOriginals)
			.values(
				written.map((w) => ({
					ownerId,
					displayName: w.file.name,
					mimeType: w.file.mime,
					extension: w.file.ext,
					sizeBytes: w.size,
					sha256: w.sha256,
					storageRootId: root.id,
					relativePath: w.relativePath,
					archiveName: w.file.archiveName
				}))
			)
			.returning();
		return { files: rows.map(publicUpload), skipped };
	} catch (e) {
		for (const w of written) await deleteRetained(root.id, w.relativePath).catch(() => {});
		throw e;
	}
}

export async function listUploads(ownerId: string) {
	const rows = await db()
		.select()
		.from(schema.uploadedOriginals)
		.where(and(eq(schema.uploadedOriginals.ownerId, ownerId), eq(schema.uploadedOriginals.status, 'active')))
		.orderBy(desc(schema.uploadedOriginals.createdAt));
	return rows.map(publicUpload);
}

/** Active uploads owned by this user, in the requested order; any other id is refused. */
export async function ownedActiveUploads(ownerId: string, ids: string[]): Promise<Row[]> {
	if (!ids.length) return [];
	if (new Set(ids).size !== ids.length) throw new AppError('VALIDATION_FAILED', '같은 첨부 파일이 두 번 들어 있습니다');
	const rows = await db()
		.select()
		.from(schema.uploadedOriginals)
		.where(
			and(
				eq(schema.uploadedOriginals.ownerId, ownerId),
				eq(schema.uploadedOriginals.status, 'active'),
				inArray(schema.uploadedOriginals.id, ids)
			)
		);
	return ids.map((id) => {
		const r = rows.find((x) => x.id === id);
		if (!r) throw new AppError('VALIDATION_FAILED', '첨부 파일을 찾을 수 없습니다 (삭제되었거나 다른 사용자의 파일)');
		return r;
	});
}

/** Read a retained original and check it still has the bytes recorded at upload. */
export async function readOriginal(ownerId: string, id: string): Promise<{ row: Row; bytes: Buffer }> {
	const [row] = await ownedActiveUploads(ownerId, [id]).catch(() => [] as Row[]);
	if (!row) throw new AppError('SOURCE_MISSING', '첨부한 원본 파일이 삭제되었거나 접근할 수 없음 (다른 파일로 대체하지 않음)', 'preparing');
	const bytes = await readRetained(row.storageRootId, row.relativePath).catch(() => {
		throw new AppError('SOURCE_MISSING', `첨부 원본 "${row.displayName}"을(를) 저장소에서 찾을 수 없음`, 'preparing');
	});
	if (createHash('sha256').update(bytes).digest('hex') !== row.sha256)
		throw new AppError('STORAGE_FAILED', `첨부 원본 "${row.displayName}"의 내용이 업로드 때와 다름 (무결성 오류)`, 'preparing');
	return { row, bytes };
}

/**
 * Explicit user deletion. Refused while a non-archived task still uses the
 * file; the dependent tasks are returned so the UI can show them.
 */
export async function deleteUpload(ownerId: string, id: string) {
	if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('NOT_FOUND', 'not found');
	const [row] = await db()
		.select()
		.from(schema.uploadedOriginals)
		.where(
			and(eq(schema.uploadedOriginals.id, id), eq(schema.uploadedOriginals.ownerId, ownerId), eq(schema.uploadedOriginals.status, 'active'))
		)
		.limit(1);
	if (!row) throw new AppError('NOT_FOUND', 'not found');
	const users = await db()
		.selectDistinct({ id: schema.tasks.id, title: schema.tasks.title, status: schema.tasks.status })
		.from(schema.taskSources)
		.innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskSources.taskId))
		.where(and(eq(schema.taskSources.uploadId, id), eq(schema.taskSources.ownerId, ownerId), ne(schema.tasks.status, 'archived')));
	if (users.length)
		throw new AppError('CONFLICT', `이 파일을 쓰는 업무가 있어 삭제할 수 없습니다: ${users.map((t) => t.title).join(', ')}`, null, { tasks: users });
	await db()
		.update(schema.uploadedOriginals)
		.set({ status: 'deleted', deletedAt: new Date() })
		.where(eq(schema.uploadedOriginals.id, id));
	await deleteRetained(row.storageRootId, row.relativePath).catch(() => {
		/* row is already marked deleted; a leftover file is unreachable through the app */
	});
	return { deleted: true };
}
