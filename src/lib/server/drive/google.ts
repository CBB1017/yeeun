import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { config } from '../config';
import { db, schema } from '../db';
import { decrypt, encrypt } from '../crypto';
import { AppError } from '../errors';

/**
 * Google Drive access with the per-user `drive.file` grant only. The app never
 * calls update/delete on a source file; the only write is creating a new copy
 * after an explicit external-action approval.
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FIELDS = 'id,name,mimeType,modifiedTime,headRevisionId,size,md5Checksum,trashed,webViewLink,parents';

export interface DriveMeta {
	parents?: string[];
	id: string;
	name: string;
	mimeType: string;
	modifiedTime?: string;
	headRevisionId?: string;
	size?: string;
	md5Checksum?: string;
	trashed?: boolean;
	webViewLink?: string;
}

type FetchLike = typeof fetch;
let fetchImpl: FetchLike = (...a) => fetch(...a);
export function setDriveFetchForTests(f: FetchLike | undefined) {
	fetchImpl = f ?? ((...a) => fetch(...a));
}

export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
	const g = config().google;
	if (!g.clientId || !g.clientSecret) throw new AppError('NOT_CONFIGURED', 'Google OAuth가 설정되지 않음');
	const res = await fetchImpl('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: g.clientId,
			client_secret: g.clientSecret,
			refresh_token: refreshToken,
			grant_type: 'refresh_token'
		})
	}).catch(() => {
		throw new AppError('NETWORK_FAILED', 'Google 토큰 갱신 중 네트워크 오류', 'preparing');
	});
	if (res.status === 400 || res.status === 401) {
		throw new AppError('DRIVE_REAUTH_REQUIRED', 'Drive 권한을 다시 연결해야 합니다', 'preparing');
	}
	if (!res.ok) throw new AppError(res.status >= 500 ? 'UPSTREAM_5XX' : 'NETWORK_FAILED', `Google token ${res.status}`, 'preparing');
	return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

/** Valid access token for the owner's active Drive connection (refreshing as needed). */
export async function accessTokenFor(ownerId: string, connectionId?: string): Promise<{ token: string; connectionId: string }> {
	const conds = [eq(schema.oauthConnections.ownerId, ownerId), eq(schema.oauthConnections.status, 'active')];
	if (connectionId) conds.push(eq(schema.oauthConnections.id, connectionId));
	const [conn] = await db()
		.select()
		.from(schema.oauthConnections)
		.where(and(...conds))
		.limit(1);
	if (!conn) throw new AppError('DRIVE_REAUTH_REQUIRED', 'Drive가 연결되어 있지 않음', 'preparing');
	const aad = `drive:${conn.id}`;
	if (conn.encryptedAccessToken && conn.accessExpiresAt && conn.accessExpiresAt.getTime() > Date.now() + 60_000) {
		return { token: decrypt(conn.encryptedAccessToken, aad), connectionId: conn.id };
	}
	if (!conn.encryptedRefreshToken) {
		await db()
			.update(schema.oauthConnections)
			.set({ status: 'reauth_required', updatedAt: new Date() })
			.where(eq(schema.oauthConnections.id, conn.id));
		throw new AppError('DRIVE_REAUTH_REQUIRED', 'Drive 권한을 다시 연결해야 합니다', 'preparing');
	}
	try {
		const t = await refreshAccessToken(decrypt(conn.encryptedRefreshToken, aad));
		await db()
			.update(schema.oauthConnections)
			.set({
				encryptedAccessToken: encrypt(t.access_token, aad),
				accessExpiresAt: new Date(Date.now() + t.expires_in * 1000),
				updatedAt: new Date()
			})
			.where(eq(schema.oauthConnections.id, conn.id));
		return { token: t.access_token, connectionId: conn.id };
	} catch (e) {
		if (e instanceof AppError && e.code === 'DRIVE_REAUTH_REQUIRED') {
			await db()
				.update(schema.oauthConnections)
				.set({ status: 'reauth_required', updatedAt: new Date() })
				.where(eq(schema.oauthConnections.id, conn.id));
		}
		throw e;
	}
}

async function driveFetch(token: string, url: string, init: RequestInit = {}): Promise<Response> {
	let res: Response;
	try {
		res = await fetchImpl(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
	} catch {
		throw new AppError('NETWORK_FAILED', 'Google Drive 연결 실패', 'preparing');
	}
	if (res.status === 401) throw new AppError('DRIVE_REAUTH_REQUIRED', 'Drive 인증 만료', 'preparing');
	if (res.status === 403 || res.status === 404) {
		const reason = await googleErrorReason(res);
		console.warn(`[drive] ${res.status} ${reason ?? 'unknown'}`);
		if (reason && /accessNotConfigured|SERVICE_DISABLED/i.test(reason)) {
			throw new AppError('NOT_CONFIGURED', 'Google Cloud 프로젝트에서 Google Drive API가 사용 설정되지 않음 (운영자 설정)', 'preparing');
		}
		if (reason && /rateLimitExceeded|userRateLimitExceeded/i.test(reason)) {
			throw new AppError('USAGE_LIMIT', 'Google Drive 사용 한도', 'preparing');
		}
		if (reason && /appNotAuthorizedToFile|insufficientFilePermissions|insufficientPermissions/i.test(reason)) {
			throw new AppError('SOURCE_MISSING', '이 앱에 해당 파일 권한이 부여되지 않음 (Picker App ID가 프로젝트 번호와 같은지 확인)', 'preparing');
		}
		throw new AppError('SOURCE_MISSING', '허용된 파일에 접근할 수 없음 (삭제·이동 또는 권한 취소)', 'preparing');
	}
	if (res.status === 429) throw new AppError('USAGE_LIMIT', 'Google Drive 사용 한도', 'preparing');
	if (res.status >= 500) throw new AppError('UPSTREAM_5XX', `Google Drive ${res.status}`, 'preparing');
	if (!res.ok) throw new AppError('EXECUTION_FAILED', `Google Drive ${res.status}`, 'preparing');
	return res;
}

export async function getMeta(token: string, fileId: string): Promise<DriveMeta> {
	if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) throw new AppError('VALIDATION_FAILED', 'invalid file id');
	const res = await driveFetch(token, `${API}/files/${fileId}?fields=${FIELDS}&supportsAllDrives=true`);
	const meta = (await res.json()) as DriveMeta;
	if (meta.trashed) throw new AppError('SOURCE_MISSING', '파일이 휴지통에 있음', 'preparing');
	return meta;
}

export async function download(token: string, fileId: string, maxBytes: number): Promise<Buffer> {
	const res = await driveFetch(token, `${API}/files/${fileId}?alt=media&supportsAllDrives=true`);
	return readLimited(res, maxBytes);
}

export async function exportAs(token: string, fileId: string, mime: string, maxBytes: number): Promise<Buffer> {
	const res = await driveFetch(token, `${API}/files/${fileId}/export?mimeType=${encodeURIComponent(mime)}`);
	return readLimited(res, maxBytes);
}

async function readLimited(res: Response, maxBytes: number): Promise<Buffer> {
	const len = Number(res.headers.get('content-length') ?? 0);
	if (len > maxBytes) throw new AppError('SOURCE_TOO_LARGE', `파일 크기 한도(${maxBytes} bytes) 초과`, 'preparing');
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) {
		size += c.length;
		if (size > maxBytes) throw new AppError('SOURCE_TOO_LARGE', `파일 크기 한도(${maxBytes} bytes) 초과`, 'preparing');
		chunks.push(Buffer.from(c));
	}
	return Buffer.concat(chunks);
}

export function md5Hex(b: Buffer): string {
	return createHash('md5').update(b).digest('hex');
}

/** Create a NEW file in Drive (copy upload). Never updates an existing file. */
export async function uploadNewFile(token: string, name: string, mimeType: string, bytes: Buffer, parentId?: string): Promise<DriveMeta> {
	const boundary = `yeeun${Date.now()}`;
	const metadata = JSON.stringify({ name, mimeType, ...(parentId ? { parents: [parentId] } : {}) });
	const body = Buffer.concat([
		Buffer.from(
			`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
		),
		bytes,
		Buffer.from(`\r\n--${boundary}--`)
	]);
	const res = await driveFetch(token, `${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}&supportsAllDrives=true`, {
		method: 'POST',
		headers: { 'content-type': `multipart/related; boundary=${boundary}` },
		body
	});
	return res.json() as Promise<DriveMeta>;
}

export async function revokeToken(token: string): Promise<void> {
	await fetchImpl(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
}

/** Google's machine-readable error reason (e.g. accessNotConfigured, notFound); never the body text. */
async function googleErrorReason(res: Response): Promise<string | null> {
	try {
		const j = (await res.json()) as { error?: { errors?: { reason?: string }[]; status?: string; details?: { reason?: string }[] } };
		return j.error?.errors?.[0]?.reason ?? j.error?.details?.find((d) => d.reason)?.reason ?? j.error?.status ?? null;
	} catch {
		return null;
	}
}

/** Escape a value for a Drive `q` string literal. */
export function driveQueryLiteral(v: string): string {
	return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function buildSearchQuery(keywords: string[], mimeTypes: string[]): string {
	const parts = ['trashed = false', "mimeType != 'application/vnd.google-apps.folder'"];
	if (keywords.length) parts.push(`(${keywords.map((k) => `name contains '${driveQueryLiteral(k)}'`).join(' or ')})`);
	if (mimeTypes.length) parts.push(`(${mimeTypes.map((m) => `mimeType = '${driveQueryLiteral(m)}'`).join(' or ')})`);
	return parts.join(' and ');
}

/** Name search in the user's Drive (requires drive.readonly). Never downloads content. */
export async function searchFiles(token: string, keywords: string[], mimeTypes: string[], pageSize = 50): Promise<DriveMeta[]> {
	const q = buildSearchQuery(keywords, mimeTypes);
	const url = `${API}/files?q=${encodeURIComponent(q)}&pageSize=${pageSize}&orderBy=modifiedTime desc&fields=files(${FIELDS})&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`;
	const res = await driveFetch(token, url);
	return ((await res.json()) as { files?: DriveMeta[] }).files ?? [];
}

export async function folderName(token: string, folderId: string): Promise<string | null> {
	try {
		const res = await driveFetch(token, `${API}/files/${folderId}?fields=name&supportsAllDrives=true`);
		return ((await res.json()) as { name?: string }).name ?? null;
	} catch {
		return null;
	}
}
