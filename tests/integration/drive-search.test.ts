import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDatabase } from '../setup/db';

useTestDatabase();

const { db, schema, closeDb } = await import('../../src/lib/server/db');
const { encrypt } = await import('../../src/lib/server/crypto');
const { setDriveFetchForTests, DRIVE_READONLY_SCOPE, DRIVE_SCOPE, buildSearchQuery } = await import('../../src/lib/server/drive/google');
const { searchDrive, addGrants } = await import('../../src/lib/server/drive/service');
const { searchHints } = await import('../../src/lib/server/plan/interpret');
const h = await import('./helpers');

afterAll(async () => {
	setDriveFetchForTests(undefined);
	await closeDb();
});

describe('natural-language Drive search [MOCK Drive API]', () => {
	it('extracts file-name clues and MIME hints without schedule/action words', () => {
		const r = searchHints('월~목 오전 10시와 오후 2시에 연구과제 엑셀에서 한 달 이내 마감인 과제 목록을 메일로 보내줘');
		expect(r.keywords).toContain('연구과제');
		expect(r.keywords).not.toContain('마감');
		expect(r.keywords).not.toContain('메일로');
		expect(r.mimeTypes).toContain('application/vnd.google-apps.spreadsheet');
	});

	it("escapes quotes in the Drive query so names can't break out of the literal", () => {
		const q = buildSearchQuery(["o'brien"], []);
		expect(q).toContain("name contains 'o\\'brien'");
	});

	it('requires the readonly scope, ranks candidates, and only a confirmed candidate becomes a grant', async () => {
		const { user, connection } = await h.setupTask();
		await db()
			.update(schema.oauthConnections)
			.set({ encryptedAccessToken: encrypt('fake', `drive:${connection.id}`), accessExpiresAt: new Date(Date.now() + 3600_000), scopes: [DRIVE_SCOPE] })
			.where(eq(schema.oauthConnections.id, connection.id));
		const noScope = await searchDrive(user.id, '연구과제 엑셀');
		expect(noScope.available).toBe(false);

		await db().update(schema.oauthConnections).set({ scopes: [DRIVE_SCOPE, DRIVE_READONLY_SCOPE] }).where(eq(schema.oauthConnections.id, connection.id));
		const seen: string[] = [];
		setDriveFetchForTests((async (url: string | URL) => {
			const u = String(url);
			seen.push(u);
			if (u.includes('/files?q=')) {
				return new Response(
					JSON.stringify({
						files: [
							{ id: 'fileOTHER0001', name: '회계 예산.xlsx', mimeType: 'x', parents: ['folderA00001'] },
							{ id: 'fileRESEARCH1', name: '대학 연구과제 목록.xlsx', mimeType: 'x', parents: ['folderA00001'], modifiedTime: '2026-11-01T00:00:00Z' }
						]
					})
				);
			}
			if (u.includes('/files/folderA00001')) return new Response(JSON.stringify({ name: '연구실' }));
			if (u.includes('/files/fileRESEARCH1')) return new Response(JSON.stringify({ id: 'fileRESEARCH1', name: '대학 연구과제 목록.xlsx', mimeType: 'x' }));
			return new Response('{}', { status: 404 });
		}) as typeof fetch);

		const found = await searchDrive(user.id, '연구과제 엑셀에서 마감 목록');
		expect(found.available).toBe(true);
		expect(found.candidates.map((c) => c.fileId)).toEqual(['fileRESEARCH1']);
		expect(found.candidates[0]!.folder).toBe('연구실');
		// search never downloads content
		expect(seen.some((u) => u.includes('alt=media') || u.includes('/export'))).toBe(false);
		// nothing is granted until the user confirms
		const before = await db().select().from(schema.fileGrants).where(eq(schema.fileGrants.providerFileId, 'fileRESEARCH1'));
		expect(before.length).toBe(0);
		const r = await addGrants(user.id, ['fileRESEARCH1']);
		expect(r.added.map((g) => g.providerFileId)).toEqual(['fileRESEARCH1']);
	});
});
