import { mkdir, open, rename, rm, stat, lstat, realpath, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { config } from './config';
import { db, schema, type DbOrTx } from './db';
import { AppError } from './errors';

/**
 * Retained-file layout under a storage root (container path, default /data):
 *   users/<uuid>/runs/<uuid>/{snapshots,evidence,results,artifacts,partial}/<generated name>
 * User-provided filenames are never used as path segments.
 */

export type RunArea = 'snapshots' | 'evidence' | 'results' | 'artifacts' | 'partial' | 'work';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export function runRelativeDir(ownerId: string, runId: string, area: RunArea): string {
	if (!UUID_RE.test(ownerId) || !UUID_RE.test(runId)) throw new AppError('STORAGE_FAILED', 'invalid id');
	return path.posix.join('users', ownerId, 'runs', runId, area);
}

/**
 * Retained originals attached from the user's PC: users/<uuid>/originals/<generated name>.
 * Outside every run directory, so per-run cleanup never touches them.
 */
export function originalsRelativeDir(ownerId: string): string {
	if (!UUID_RE.test(ownerId)) throw new AppError('STORAGE_FAILED', 'invalid id');
	return path.posix.join('users', ownerId, 'originals');
}

export function generatedName(ext: string): string {
	const clean = ext.replace(/^\./, '').toLowerCase();
	if (!/^[a-z0-9]{1,8}$/.test(clean)) throw new AppError('STORAGE_FAILED', 'invalid extension');
	return `${randomUUID()}.${clean}`;
}

/**
 * Resolve a DB-recorded relative path against a root, refusing absolute paths,
 * `..` segments and symlinks that escape the root.
 */
export async function resolveInsideRoot(rootPath: string, relativePath: string): Promise<string> {
	if (path.isAbsolute(relativePath) || relativePath.includes('\\') || relativePath.includes('\0')) {
		throw new AppError('STORAGE_FAILED', 'path rejected');
	}
	const segments = relativePath.split('/');
	if (segments.some((s) => s === '..' || s === '' || s === '.')) {
		throw new AppError('STORAGE_FAILED', 'path rejected');
	}
	for (const s of segments) {
		if (!SAFE_NAME_RE.test(s)) throw new AppError('STORAGE_FAILED', 'path rejected');
	}
	const root = await realpath(rootPath);
	const candidate = path.resolve(root, ...segments);
	if (candidate !== root && !candidate.startsWith(root + path.sep)) {
		throw new AppError('STORAGE_FAILED', 'path rejected');
	}
	// Walk existing components and refuse symlinks.
	let cur = root;
	for (const s of segments) {
		cur = path.join(cur, s);
		try {
			const st = await lstat(cur);
			if (st.isSymbolicLink()) throw new AppError('STORAGE_FAILED', 'symlink rejected');
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === 'ENOENT') break;
			throw e;
		}
	}
	return candidate;
}

export interface ActiveRoot {
	id: string;
	containerPath: string;
}

/** Ensures a storage_roots row for the configured mount exists (called by migrate and worker). */
export async function ensureActiveRoot(tx: DbOrTx = db()): Promise<ActiveRoot> {
	const existing = await tx.select().from(schema.storageRoots).where(eq(schema.storageRoots.status, 'active')).limit(1);
	if (existing[0]) return { id: existing[0].id, containerPath: existing[0].containerPath };
	const cfg = config();
	const [row] = await tx
		.insert(schema.storageRoots)
		.values({
			label: 'default',
			hostLabel: cfg.fileStorageHostLabel,
			containerPath: cfg.fileStorageRoot,
			status: 'active',
			activatedAt: new Date()
		})
		.returning();
	return { id: row.id, containerPath: row.containerPath };
}

export async function rootById(id: string, tx: DbOrTx = db()): Promise<ActiveRoot> {
	const [row] = await tx
		.select()
		.from(schema.storageRoots)
		.where(and(eq(schema.storageRoots.id, id)))
		.limit(1);
	if (!row) throw new AppError('STORAGE_FAILED', 'unknown storage root');
	return { id: row.id, containerPath: row.containerPath };
}

export interface WrittenFile {
	relativePath: string;
	absolutePath: string;
	sha256: string;
	sizeBytes: number;
}

/** Write via temp file + fsync + atomic rename; returns hash. */
export async function writeFileAtomic(
	root: ActiveRoot,
	relativeDir: string,
	fileName: string,
	data: Buffer | string
): Promise<WrittenFile> {
	const relativePath = path.posix.join(relativeDir, fileName);
	const absDir = path.join(root.containerPath, ...relativeDir.split('/'));
	await mkdir(absDir, { recursive: true, mode: 0o750 });
	const finalPath = await resolveInsideRoot(root.containerPath, relativePath);
	const tmp = `${finalPath}.tmp-${randomUUID()}`;
	const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
	const fh = await open(tmp, 'wx', 0o640);
	try {
		await fh.writeFile(buf);
		await fh.sync();
	} finally {
		await fh.close();
	}
	await rename(tmp, finalPath);
	const dirFh = await open(absDir, 'r');
	try {
		await dirFh.sync();
	} catch {
		/* directory fsync unsupported on some filesystems */
	} finally {
		await dirFh.close();
	}
	return {
		relativePath,
		absolutePath: finalPath,
		sha256: createHash('sha256').update(buf).digest('hex'),
		sizeBytes: buf.length
	};
}

export async function readRetained(rootId: string, relativePath: string): Promise<Buffer> {
	const root = await rootById(rootId);
	return readFile(await resolveInsideRoot(root.containerPath, relativePath));
}

export async function openRetainedStream(rootId: string, relativePath: string) {
	const root = await rootById(rootId);
	const abs = await resolveInsideRoot(root.containerPath, relativePath);
	const st = await stat(abs);
	return { stream: createReadStream(abs), size: st.size };
}

export async function deleteRetained(rootId: string, relativePath: string): Promise<void> {
	const root = await rootById(rootId);
	const abs = await resolveInsideRoot(root.containerPath, relativePath);
	await rm(abs, { force: true });
}

export async function fileSha256(absPath: string): Promise<string> {
	const h = createHash('sha256');
	for await (const chunk of createReadStream(absPath)) h.update(chunk as Buffer);
	return h.digest('hex');
}

/** Checks that a container path is a writable mounted directory (used for root changes). */
export async function probeWritable(containerPath: string): Promise<boolean> {
	try {
		const st = await stat(containerPath);
		if (!st.isDirectory()) return false;
		const probe = path.join(containerPath, `.probe-${randomUUID()}`);
		const fh = await open(probe, 'wx');
		await fh.close();
		await rm(probe);
		return true;
	} catch {
		return false;
	}
}
