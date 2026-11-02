import { and, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { config, pickerConfigured } from '../config';
import { decrypt, encrypt } from '../crypto';
import { AppError } from '../errors';
import { accessTokenFor, getMeta, revokeToken, DRIVE_SCOPE } from './google';
import type { FlowResult } from '../auth/google-oidc';

export async function saveConnection(ownerId: string, r: FlowResult) {
	if (!r.scopes.includes(DRIVE_SCOPE)) throw new AppError('DRIVE_REAUTH_REQUIRED', 'Drive 파일 권한(drive.file)에 동의하지 않았습니다');
	if (!r.refreshToken) throw new AppError('DRIVE_REAUTH_REQUIRED', '오프라인 접근 권한이 발급되지 않음 — 다시 연결하세요');
	return db().transaction(async (tx) => {
		const [prev] = await tx
			.select()
			.from(schema.oauthConnections)
			.where(and(eq(schema.oauthConnections.ownerId, ownerId), eq(schema.oauthConnections.status, 'active')))
			.limit(1);
		if (prev && prev.subject !== r.sub) {
			// Switching Drive accounts: old grants belong to the old account.
			await tx
				.update(schema.fileGrants)
				.set({ status: 'revoked', revokedAt: new Date() })
				.where(and(eq(schema.fileGrants.connectionId, prev.id), eq(schema.fileGrants.status, 'active')));
		}
		if (prev)
			await tx
				.update(schema.oauthConnections)
				.set({ status: 'revoked', updatedAt: new Date() })
				.where(eq(schema.oauthConnections.id, prev.id));
		const [conn] = await tx
			.insert(schema.oauthConnections)
			.values({ ownerId, subject: r.sub, email: r.email, scopes: r.scopes, status: 'active' })
			.returning();
		const aad = `drive:${conn!.id}`;
		await tx
			.update(schema.oauthConnections)
			.set({
				encryptedRefreshToken: encrypt(r.refreshToken!, aad),
				encryptedAccessToken: encrypt(r.accessToken, aad),
				accessExpiresAt: new Date(Date.now() + r.expiresIn * 1000)
			})
			.where(eq(schema.oauthConnections.id, conn!.id));
		if (prev && prev.subject === r.sub) {
			await tx
				.update(schema.fileGrants)
				.set({ connectionId: conn!.id })
				.where(and(eq(schema.fileGrants.connectionId, prev.id), eq(schema.fileGrants.status, 'active')));
		}
		return conn!;
	});
}

export async function connectionStatus(ownerId: string) {
	const [c] = await db()
		.select({
			id: schema.oauthConnections.id,
			email: schema.oauthConnections.email,
			status: schema.oauthConnections.status,
			createdAt: schema.oauthConnections.createdAt
		})
		.from(schema.oauthConnections)
		.where(and(eq(schema.oauthConnections.ownerId, ownerId), inArray(schema.oauthConnections.status, ['active', 'reauth_required'])))
		.orderBy(desc(schema.oauthConnections.createdAt))
		.limit(1);
	return c ?? null;
}

export async function pickerConfig(ownerId: string) {
	if (!pickerConfigured()) throw new AppError('NOT_CONFIGURED', 'Google Picker가 설정되지 않음 (운영자 설정 필요)');
	const g = config().google;
	if (!/^[0-9]{6,20}$/.test(g.pickerAppId ?? '')) {
		throw new AppError('NOT_CONFIGURED', 'GOOGLE_PICKER_APP_ID는 프로젝트 ID가 아니라 숫자로 된 프로젝트 번호여야 합니다 (OAuth 클라이언트 ID 앞부분)');
	}
	const { token } = await accessTokenFor(ownerId);
	return { apiKey: g.pickerApiKey, appId: g.pickerAppId, clientId: g.clientId, accessToken: token, origin: config().publicOrigin };
}

/** Register Picker-selected files after the server confirms access with the user's own token. */
export async function addGrants(ownerId: string, fileIds: string[]) {
	const { token, connectionId } = await accessTokenFor(ownerId);
	const added = [];
	const rejected: { id: string; reason: string; message: string | null }[] = [];
	for (const id of [...new Set(fileIds)].slice(0, 50)) {
		try {
			const m = await getMeta(token, id);
			const [row] = await db()
				.insert(schema.fileGrants)
				.values({
					ownerId,
					connectionId,
					providerFileId: m.id,
					name: m.name,
					mimeType: m.mimeType,
					modifiedAt: m.modifiedTime ? new Date(m.modifiedTime) : null,
					webViewLink: m.webViewLink ?? null
				})
				.onConflictDoUpdate({
					target: [schema.fileGrants.ownerId, schema.fileGrants.providerFileId],
					targetWhere: sql`${schema.fileGrants.status} = 'active'`,
					set: { name: m.name, mimeType: m.mimeType, modifiedAt: m.modifiedTime ? new Date(m.modifiedTime) : null, connectionId }
				})
				.returning();
			added.push(row!);
		} catch (e) {
			rejected.push({ id, reason: e instanceof AppError ? e.code : 'EXECUTION_FAILED', message: e instanceof AppError ? e.message : null });
		}
	}
	return { added, rejected };
}

/** App search covers ONLY the user's active grants; Drive itself is never searched. */
export async function searchGrants(ownerId: string, q: string) {
	const conds = [eq(schema.fileGrants.ownerId, ownerId), eq(schema.fileGrants.status, 'active')];
	if (q.trim()) conds.push(ilike(schema.fileGrants.name, `%${q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
	return db()
		.select({
			id: schema.fileGrants.id,
			name: schema.fileGrants.name,
			mimeType: schema.fileGrants.mimeType,
			modifiedAt: schema.fileGrants.modifiedAt,
			folderLabel: schema.fileGrants.folderLabel,
			webViewLink: schema.fileGrants.webViewLink,
			providerFileId: schema.fileGrants.providerFileId,
			createdAt: schema.fileGrants.createdAt
		})
		.from(schema.fileGrants)
		.where(and(...conds))
		.orderBy(desc(schema.fileGrants.createdAt))
		.limit(100);
}

/** Removing an app grant stops future reads; schedules depending on it are paused (no silent replacement). */
export async function removeGrant(ownerId: string, grantId: string) {
	return db().transaction(async (tx) => {
		const [g] = await tx
			.update(schema.fileGrants)
			.set({ status: 'revoked', revokedAt: new Date() })
			.where(and(eq(schema.fileGrants.id, grantId), eq(schema.fileGrants.ownerId, ownerId), eq(schema.fileGrants.status, 'active')))
			.returning();
		if (!g) throw new AppError('NOT_FOUND', 'not found');
		await pauseDependents(tx, ownerId, [g.id]);
		return g;
	});
}

async function pauseDependents(
	tx: Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0],
	ownerId: string,
	grantIds: string[]
) {
	if (!grantIds.length) return;
	const deps = await tx
		.selectDistinct({ taskId: schema.taskSources.taskId })
		.from(schema.taskSources)
		.where(and(eq(schema.taskSources.ownerId, ownerId), inArray(schema.taskSources.grantId, grantIds)));
	const ids = deps.map((d) => d.taskId);
	if (!ids.length) return;
	await tx
		.update(schema.tasks)
		.set({ status: 'paused', updatedAt: new Date() })
		.where(and(inArray(schema.tasks.id, ids), eq(schema.tasks.status, 'active')));
	await tx.update(schema.schedules).set({ active: false, updatedAt: new Date() }).where(inArray(schema.schedules.taskId, ids));
}

/** Disconnect Drive: revoke token, stop future reads and related schedules; keep past results. */
export async function disconnect(ownerId: string) {
	const [c] = await db()
		.select()
		.from(schema.oauthConnections)
		.where(and(eq(schema.oauthConnections.ownerId, ownerId), inArray(schema.oauthConnections.status, ['active', 'reauth_required'])))
		.limit(1);
	if (!c) return { disconnected: false };
	if (c.encryptedRefreshToken) await revokeToken(decrypt(c.encryptedRefreshToken, `drive:${c.id}`)).catch(() => {});
	await db().transaction(async (tx) => {
		await tx
			.update(schema.oauthConnections)
			.set({ status: 'revoked', encryptedAccessToken: null, encryptedRefreshToken: null, updatedAt: new Date() })
			.where(eq(schema.oauthConnections.id, c.id));
		const grants = await tx
			.update(schema.fileGrants)
			.set({ status: 'revoked', revokedAt: new Date() })
			.where(and(eq(schema.fileGrants.connectionId, c.id), eq(schema.fileGrants.status, 'active')))
			.returning({ id: schema.fileGrants.id });
		await pauseDependents(
			tx,
			ownerId,
			grants.map((g) => g.id)
		);
	});
	return { disconnected: true };
}
