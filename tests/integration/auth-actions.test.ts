import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDatabase, createUser } from '../setup/db';

useTestDatabase();
process.env.BOOTSTRAP_ADMIN_EMAIL = 'owner@example.test';

const { db, schema, closeDb } = await import('../../src/lib/server/db');
const { resetConfigForTests } = await import('../../src/lib/server/config');
resetConfigForTests();
const auth = await import('../../src/lib/server/auth/users');
const { encrypt, sha256Hex } = await import('../../src/lib/server/crypto');
const { approveAction, approvalHash, executeApprovedActions, rejectAction } = await import('../../src/lib/server/external/actions');
const { setDriveFetchForTests } = await import('../../src/lib/server/drive/google');
const { ensureActiveRoot, writeFileAtomic, runRelativeDir, generatedName } = await import('../../src/lib/server/storage');
const { searchGrants, disconnect } = await import('../../src/lib/server/drive/service');
const h = await import('./helpers');

afterAll(async () => {
	setDriveFetchForTests(undefined);
	await closeDb();
});

const flow = (sub: string, email: string, verified = true) => ({
	sub,
	email,
	emailVerified: verified,
	name: 'T',
	scopes: [],
	accessToken: 'x',
	refreshToken: null,
	expiresIn: 3600
});

describe('A01 invitation-only Google sign-in', () => {
	it('rejects uninvited and unverified accounts without creating users', async () => {
		await expect(auth.signInWithGoogle(flow('s-uninvited', 'nobody@example.test'))).rejects.toMatchObject({ code: 'INVITATION_REQUIRED' });
		await expect(auth.signInWithGoogle(flow('s-unverified', 'owner@example.test', false))).rejects.toMatchObject({
			code: 'INVITATION_REQUIRED'
		});
		const rows = await db().select().from(schema.users).where(eq(schema.users.googleSub, 's-uninvited'));
		expect(rows.length).toBe(0);
	});

	it('bootstraps the first admin, binds invitations by subject, and revoke blocks sessions immediately', async () => {
		const admin = await auth.signInWithGoogle(flow('s-owner', 'owner@example.test'));
		expect(admin.role).toBe('admin');
		const inv = await auth.invite(admin.id, 'Friend@Example.test');
		const friend = await auth.signInWithGoogle(flow('s-friend', 'friend@example.test'));
		expect(friend.role).toBe('user');
		// a different Google account with the same email cannot reuse the bound invitation
		await expect(auth.signInWithGoogle(flow('s-impostor', 'friend@example.test'))).rejects.toMatchObject({ code: 'INVITATION_REQUIRED' });
		const s = await auth.createSession(friend.id);
		expect((await auth.userForSession(s.token))?.id).toBe(friend.id);
		await auth.revokeInvitation(admin.id, inv.id);
		expect(await auth.userForSession(s.token)).toBeNull();
		await expect(auth.signInWithGoogle(flow('s-friend', 'friend@example.test'))).rejects.toMatchObject({ code: 'INVITATION_REQUIRED' });
	});
});

describe('A03 allowed-file search scope', () => {
	it("search only returns the owner's active grants; disconnect pauses dependent tasks and keeps results", async () => {
		const { user, task } = await h.setupTask();
		const other = await h.setupTask();
		const found = await searchGrants(user.id, '연구');
		expect(found.length).toBe(1);
		expect(found[0]!.providerFileId).not.toBe(other.grant.providerFileId);
		await disconnect(user.id);
		expect(await searchGrants(user.id, '')).toEqual([]);
		const [t] = await db().select().from(schema.tasks).where(eq(schema.tasks.id, task.id));
		expect(t!.status).toBe('paused');
	});
});

describe('A19 external transmission approval [MOCK Drive upload]', () => {
	it('requires approval of the exact hash/destination, executes once, and re-approval after change', async () => {
		const { user, task, connection } = await h.setupTask();
		await db()
			.update(schema.oauthConnections)
			.set({ encryptedAccessToken: encrypt('fake-access', `drive:${connection.id}`), accessExpiresAt: new Date(Date.now() + 3600_000) })
			.where(eq(schema.oauthConnections.id, connection.id));
		const [run] = await db()
			.insert(schema.runs)
			.values({ ownerId: user.id, taskId: task.id, trigger: 'manual', state: 'completed', planRevision: 1, plan: task.plan as object })
			.returning();
		const root = await ensureActiveRoot();
		const bytes = Buffer.from('a,b\n1,2\n');
		const w = await writeFileAtomic(root, runRelativeDir(user.id, run!.id, 'artifacts'), generatedName('csv'), bytes);
		const [art] = await db()
			.insert(schema.artifacts)
			.values({
				runId: run!.id,
				ownerId: user.id,
				storageRootId: root.id,
				relativePath: w.relativePath,
				mimeType: 'text/csv',
				filename: 'r.csv',
				format: 'csv',
				sizeBytes: w.sizeBytes,
				sha256: w.sha256,
				validation: {}
			})
			.returning();
		const destination = { label: '공유 폴더' };
		const [act] = await db()
			.insert(schema.externalActions)
			.values({
				ownerId: user.id,
				runId: run!.id,
				artifactId: art!.id,
				artifactSha256: art!.sha256,
				action: 'drive_upload_copy',
				destination,
				destinationHash: sha256Hex(JSON.stringify(destination))
			})
			.returning();

		let uploads = 0;
		setDriveFetchForTests((async (url: string | URL, init?: RequestInit) => {
			if (String(url).includes('/upload/drive/v3/files') && init?.method === 'POST') {
				uploads++;
				return new Response(JSON.stringify({ id: 'newfile123456', name: 'r.csv', mimeType: 'text/csv' }), { status: 200 });
			}
			return new Response('{}', { status: 404 });
		}) as typeof fetch);

		// nothing is sent before approval
		expect(await executeApprovedActions()).toBe(0);
		expect(uploads).toBe(0);
		// a stale/incorrect confirmation is refused
		await expect(approveAction(user.id, act!.id, '0'.repeat(64))).rejects.toMatchObject({ code: 'CONFLICT' });
		// another owner cannot approve
		const stranger = await createUser();
		await expect(approveAction(stranger.id, act!.id, approvalHash(act!))).rejects.toMatchObject({ code: 'NOT_FOUND' });
		await approveAction(user.id, act!.id, approvalHash(act!));
		await approveAction(user.id, act!.id, approvalHash(act!)); // duplicate click is harmless
		expect(await executeApprovedActions()).toBe(1);
		expect(await executeApprovedActions()).toBe(0); // single use
		expect(uploads).toBe(1);

		// artifact changed after approval request -> approval invalidated
		const [act2] = await db()
			.insert(schema.externalActions)
			.values({
				ownerId: user.id,
				runId: run!.id,
				artifactId: art!.id,
				artifactSha256: art!.sha256,
				action: 'drive_upload_copy',
				destination,
				destinationHash: 'x'
			})
			.returning();
		await db()
			.update(schema.artifacts)
			.set({ sha256: 'f'.repeat(64) })
			.where(eq(schema.artifacts.id, art!.id));
		await expect(approveAction(user.id, act2!.id, approvalHash(act2!))).rejects.toMatchObject({ code: 'CONFLICT' });
		await expect(rejectAction(user.id, act2!.id)).rejects.toMatchObject({ code: 'CONFLICT' });
		expect(uploads).toBe(1);
	});
});
