import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db, schema } from '../db';
import { config } from '../config';
import { AppError } from '../errors';
import { hashJson } from '../crypto';
import { ensureActiveRoot, generatedName, readRetained, runRelativeDir, writeFileAtomic } from '../storage';
import { accessTokenFor, download, exportAs, getMeta, md5Hex, type DriveMeta } from '../drive/google';
import { parseSource, EXTRACTION_VERSION, GOOGLE_EXPORTS } from '../parsers';
import { SourceManifestSchema, type ManifestFile, type SourceManifest } from '../../shared/manifest';
import type { TaskPlan } from '../../shared/plan';
import { readOriginal } from '../uploads/service';

/**
 * Freeze source bytes for a run. Each selected Drive file is read by its bound
 * Drive file id (never re-discovered), checked for changes during capture,
 * and each attached upload is read from its retained original (sha256-checked);
 * both are hashed, stored under the run's snapshots area and parsed once. Both CLI
 * executions (and a round-2 review) receive this same manifest.
 */

export interface SourceFetcher {
	meta(ownerId: string, fileId: string): Promise<DriveMeta>;
	bytes(ownerId: string, meta: DriveMeta, maxBytes: number): Promise<{ bytes: Buffer; exportFormat: string | null; mime: string }>;
}

export const driveFetcher: SourceFetcher = {
	async meta(ownerId, fileId) {
		const { token } = await accessTokenFor(ownerId);
		return getMeta(token, fileId);
	},
	async bytes(ownerId, meta, maxBytes) {
		const { token } = await accessTokenFor(ownerId);
		const exp = GOOGLE_EXPORTS[meta.mimeType];
		if (exp) return { bytes: await exportAs(token, meta.id, exp.mime, maxBytes), exportFormat: exp.format, mime: exp.mime };
		return { bytes: await download(token, meta.id, maxBytes), exportFormat: null, mime: meta.mimeType };
	}
};

let fetcher: SourceFetcher = driveFetcher;
export function setSourceFetcherForTests(f: SourceFetcher | undefined) {
	fetcher = f ?? driveFetcher;
}

export function manifestHash(m: SourceManifest): string {
	return hashJson(m);
}

export async function captureSources(run: {
	id: string;
	ownerId: string;
	plan: unknown;
}): Promise<{ manifest: SourceManifest; hash: string; summary: unknown }> {
	const plan = run.plan as TaskPlan;
	const cfg = config();
	const root = await ensureActiveRoot();
	const files: ManifestFile[] = [];
	const ocrBudget = { used: 0 };
	let total = 0;
	for (const [index, src] of plan.sources.entries()) {
		if ('upload_id' in src) {
			// Attached from the user's PC: the retained original is the source (never re-uploaded or replaced).
			const { row, bytes } = await readOriginal(run.ownerId, src.upload_id);
			if (bytes.length > cfg.maxSourceFileBytes) throw new AppError('SOURCE_TOO_LARGE', `"${row.displayName}" 크기 한도 초과`, 'preparing');
			total += bytes.length;
			if (total > cfg.maxRunSourceBytes) throw new AppError('SOURCE_TOO_LARGE', '실행당 원본 크기 한도 초과', 'preparing');
			const capturedAt = new Date();
			const written = await writeFileAtomic(root, runRelativeDir(run.ownerId, run.id, 'snapshots'), generatedName(row.extension), bytes);
			const [snap] = await db()
				.insert(schema.sourceSnapshots)
				.values({
					runId: run.id,
					ownerId: run.ownerId,
					uploadId: row.id,
					providerFileId: row.id,
					name: row.displayName,
					mimeType: row.mimeType,
					providerRevision: null,
					providerModifiedAt: row.createdAt,
					capturedAt,
					sha256: written.sha256,
					sizeBytes: written.sizeBytes,
					exportFormat: null,
					storageRootId: root.id,
					relativePath: written.relativePath,
					extractionVersion: EXTRACTION_VERSION
				})
				.returning();
			const parsed = await parseSource({
				bytes,
				mimeType: row.mimeType,
				name: row.displayName,
				fileIndex: index,
				selector: src.selector,
				maxOcrPages: cfg.maxOcrPages,
				ocrBudget
			});
			files.push({
				index,
				snapshot_id: snap!.id,
				provider_file_id: row.id,
				name: row.displayName,
				mime_type: row.mimeType,
				provider_revision: null,
				provider_modified_at: row.createdAt.toISOString(),
				captured_at: capturedAt.toISOString(),
				sha256: written.sha256,
				export_format: null,
				extraction_version: EXTRACTION_VERSION,
				tables: parsed.tables,
				texts: parsed.texts,
				warnings: parsed.warnings
			});
			continue;
		}
		// The grant must still be active and owned by this user.
		const [grant] = await db()
			.select()
			.from(schema.fileGrants)
			.where(
				and(eq(schema.fileGrants.id, src.grant_id), eq(schema.fileGrants.ownerId, run.ownerId), eq(schema.fileGrants.status, 'active'))
			)
			.limit(1);
		if (!grant || grant.providerFileId !== src.provider_file_id) {
			throw new AppError('SOURCE_MISSING', `허용된 파일 "${src.name}"의 접근 권한이 없음 (다른 파일로 대체하지 않음)`, 'preparing');
		}
		const before = await fetcher.meta(run.ownerId, src.provider_file_id);
		const size = Number(before.size ?? 0);
		if (size > cfg.maxSourceFileBytes) throw new AppError('SOURCE_TOO_LARGE', `"${before.name}" 크기 한도 초과`, 'preparing');
		const got = await fetcher.bytes(run.ownerId, before, cfg.maxSourceFileBytes);
		total += got.bytes.length;
		if (total > cfg.maxRunSourceBytes) throw new AppError('SOURCE_TOO_LARGE', '실행당 원본 크기 한도 초과', 'preparing');
		const after = await fetcher.meta(run.ownerId, src.provider_file_id);
		const changed =
			before.modifiedTime !== after.modifiedTime ||
			before.headRevisionId !== after.headRevisionId ||
			(before.md5Checksum && got.exportFormat === null && md5Hex(got.bytes) !== before.md5Checksum);
		if (changed) {
			throw new AppError('SOURCE_CHANGED_DURING_CAPTURE', `"${before.name}"이(가) 읽는 중에 변경됨 — 다시 실행하세요`, 'preparing');
		}
		const capturedAt = new Date();
		const ext =
			got.exportFormat ??
			((before.name.split('.').pop() || 'bin')
				.toLowerCase()
				.replace(/[^a-z0-9]/g, '')
				.slice(0, 8) ||
				'bin');
		const written = await writeFileAtomic(root, runRelativeDir(run.ownerId, run.id, 'snapshots'), generatedName(ext), got.bytes);
		const [snap] = await db()
			.insert(schema.sourceSnapshots)
			.values({
				runId: run.id,
				ownerId: run.ownerId,
				grantId: grant.id,
				providerFileId: before.id,
				name: before.name,
				mimeType: before.mimeType,
				providerRevision: before.headRevisionId ?? null,
				providerModifiedAt: validDate(before.modifiedTime),
				capturedAt,
				sha256: written.sha256,
				sizeBytes: written.sizeBytes,
				exportFormat: got.exportFormat,
				storageRootId: root.id,
				relativePath: written.relativePath,
				extractionVersion: EXTRACTION_VERSION
			})
			.returning();
		const parsed = await parseSource({
			bytes: got.bytes,
			mimeType: got.mime,
			name: got.exportFormat ? `${before.name}.${got.exportFormat}` : before.name,
			fileIndex: index,
			selector: src.selector,
			maxOcrPages: cfg.maxOcrPages,
			ocrBudget
		});
		files.push({
			index,
			snapshot_id: snap!.id,
			provider_file_id: before.id,
			name: before.name,
			mime_type: before.mimeType,
			provider_revision: before.headRevisionId ?? null,
			provider_modified_at: before.modifiedTime ?? null,
			captured_at: capturedAt.toISOString(),
			sha256: written.sha256,
			export_format: got.exportFormat,
			extraction_version: EXTRACTION_VERSION,
			tables: parsed.tables,
			texts: parsed.texts,
			warnings: parsed.warnings
		});
	}
	const manifest = SourceManifestSchema.parse({ schema_version: 1, run_id: run.id, files });
	const hash = manifestHash(manifest);
	// Full extraction is part of the raw snapshot lifecycle (deleted after completion).
	const mf = await writeFileAtomic(root, runRelativeDir(run.ownerId, run.id, 'snapshots'), generatedName('json'), JSON.stringify(manifest));
	await db()
		.insert(schema.retainedCopies)
		.values({
			runId: run.id,
			ownerId: run.ownerId,
			kind: 'manifest',
			storageRootId: root.id,
			relativePath: mf.relativePath,
			sha256: mf.sha256,
			data: { manifest_hash: hash }
		});
	const summary = versionSummary(manifest, hash);
	return { manifest, hash, summary };
}

export function versionSummary(m: SourceManifest, hash: string) {
	return {
		manifest_hash: hash,
		files: m.files.map((f) => ({
			index: f.index,
			snapshot_id: f.snapshot_id,
			provider_file_id: f.provider_file_id,
			name: f.name,
			mime_type: f.mime_type,
			provider_revision: f.provider_revision,
			provider_modified_at: f.provider_modified_at,
			captured_at: f.captured_at,
			sha256: f.sha256,
			export_format: f.export_format,
			warnings: f.warnings,
			tables: f.tables.map((t) => ({ label: t.label, rows: t.rows.length, columns: t.columns.length }))
		}))
	};
}

/** Round 2 reuses the frozen manifest; its hash must equal round 1's. */
export async function loadFrozenManifest(run: { id: string; ownerId: string; manifestHash: string | null }): Promise<SourceManifest> {
	const [copy] = await db()
		.select()
		.from(schema.retainedCopies)
		.where(and(eq(schema.retainedCopies.runId, run.id), eq(schema.retainedCopies.kind, 'manifest')))
		.limit(1);
	if (!copy) throw new AppError('SOURCE_MISSING', '최초 원본 스냅샷이 없음', 'preparing');
	const buf = await readRetained(copy.storageRootId, copy.relativePath);
	if (createHash('sha256').update(buf).digest('hex') !== copy.sha256)
		throw new AppError('STORAGE_FAILED', '보관 스냅샷 무결성 오류', 'preparing');
	const manifest = SourceManifestSchema.parse(JSON.parse(buf.toString('utf8')));
	if (manifestHash(manifest) !== run.manifestHash) throw new AppError('STORAGE_FAILED', '스냅샷 hash 불일치', 'preparing');
	return manifest;
}

function validDate(v: string | undefined): Date | null {
	if (!v) return null;
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? null : d;
}
