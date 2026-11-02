import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUser, useTestDatabase } from '../../../../tests/setup/db';
import { closeDb, db, schema } from '../db';
import { AppError } from '../errors';
import { deliverPending, listNotifications, resend } from './deliver';
import { enqueueNotifications, type EnqueueEvent } from './outbox';
import {
	confirmRecipientChange,
	createSmtpProfile,
	getSettings,
	listSenderProfiles,
	muteToday,
	registerPushSubscription,
	startRecipientChange,
	unregisterPushSubscription,
	updateSettings,
	useLoginEmail,
	verifySmtpProfile
} from './settings';
import type { MailMessage, PushTarget, SmtpSender, Transports } from './transports';

useTestDatabase();

beforeAll(() => {
	// Operator default SMTP must not be configured for the "sender not configured" case.
	for (const k of ['SMTP_HOST', 'SMTP_FROM', 'SMTP_PORT']) delete process.env[k];
});

/** MOCK transports: nothing leaves the process. Real SMTP/push is not exercised here. */
function mockTransports(opts: { mailError?: string; pushStatus?: number; verifyError?: string } = {}) {
	const calls = {
		mail: [] as Array<{ sender: SmtpSender; msg: MailMessage }>,
		push: [] as Array<{ target: PushTarget; payload: string }>,
		verify: 0
	};
	const t: Transports = {
		async sendMail(sender, msg) {
			calls.mail.push({ sender, msg });
			if (opts.mailError) throw new Error(opts.mailError);
		},
		async sendPush(target, payload) {
			calls.push.push({ target, payload });
			if (opts.pushStatus) throw Object.assign(new Error(`mock push ${opts.pushStatus}`), { statusCode: opts.pushStatus });
		},
		async verifyMail() {
			calls.verify += 1;
			if (opts.verifyError) throw new Error(opts.verifyError);
		}
	};
	return { t, calls };
}

async function createTask(ownerId: string) {
	const [t] = await db()
		.insert(schema.tasks)
		.values({ ownerId, title: 'deadline task', plan: {}, planRevision: 1, confirmedAt: new Date() })
		.returning();
	return t!;
}

function fakeSubscription() {
	return {
		endpoint: `https://push.example.test/send/${randomBytes(12).toString('hex')}`,
		keys: { p256dh: randomBytes(65).toString('base64url'), auth: randomBytes(16).toString('base64url') }
	};
}

async function withVerifiedSender(ownerId: string, from = 'sender@example.test') {
	const { t } = mockTransports();
	const p = await createSmtpProfile(ownerId, {
		label: 'mine',
		host: 'smtp.example.test',
		port: 587,
		secure: false,
		username: 'me',
		password: 'app-password-value',
		fromAddress: from
	});
	await verifySmtpProfile(p.id, t, { actorOwnerId: ownerId });
	await updateSettings(ownerId, { smtpProfileId: p.id });
	return p;
}

async function enqueue(e: Partial<EnqueueEvent> & { ownerId: string }, now?: Date) {
	return db().transaction((tx) =>
		enqueueNotifications(
			tx,
			{
				runId: randomUUID(),
				taskId: null,
				event: 'completed',
				severity: 'normal',
				title: '결과 준비됨',
				body: '3건',
				link: '/runs/x',
				...e
			},
			{ now }
		)
	);
}

async function rowsFor(ownerId: string) {
	return db().select().from(schema.notifications).where(eq(schema.notifications.ownerId, ownerId));
}

beforeEach(async () => {
	// Isolate tests: deliverPending claims globally, so park leftovers from earlier tests.
	await db()
		.update(schema.notifications)
		.set({ status: 'suppressed' })
		.where(inArray(schema.notifications.status, ['pending', 'sending']));
});

afterAll(async () => {
	await closeDb();
});

describe('channel selection (A22) [mock transports]', () => {
	it('uses only the selected push channel when email is off (mock)', async () => {
		const u = await createUser();
		await updateSettings(u.id, { pushEnabled: true });
		await registerPushSubscription(u.id, fakeSubscription(), 'laptop');
		const r = await enqueue({ ownerId: u.id });
		expect(r).toEqual({ created: 1, suppressed: 0 });
		const { t, calls } = mockTransports();
		expect(await deliverPending({ transports: t })).toEqual({ sent: 1, failed: 0 });
		expect(calls.mail).toHaveLength(0);
		expect(calls.push).toHaveLength(1);
	});

	it('uses only email when push is off (mock)', async () => {
		const u = await createUser();
		await withVerifiedSender(u.id);
		await useLoginEmail(u.id);
		await registerPushSubscription(u.id, fakeSubscription(), 'phone');
		await updateSettings(u.id, { emailEnabled: true, pushEnabled: false });
		expect(await enqueue({ ownerId: u.id })).toEqual({ created: 1, suppressed: 0 });
		const { t, calls } = mockTransports();
		expect(await deliverPending({ transports: t })).toEqual({ sent: 1, failed: 0 });
		expect(calls.push).toHaveLength(0);
		expect(calls.mail).toHaveLength(1);
		expect(calls.mail[0]!.msg.to).toBe(u.email);
	});

	it('push denied/unsupported (no subscription) creates nothing and never enables email (mock)', async () => {
		const u = await createUser();
		await useLoginEmail(u.id);
		await updateSettings(u.id, { pushEnabled: true, emailEnabled: false });
		expect(await enqueue({ ownerId: u.id, severity: 'error', event: 'error' })).toEqual({ created: 0, suppressed: 0 });
		expect((await getSettings(u.id)).emailEnabled).toBe(false);
		expect(await rowsFor(u.id)).toHaveLength(0);
	});

	it('email enabled without a verified recipient is not used', async () => {
		const u = await createUser();
		await updateSettings(u.id, { emailEnabled: true });
		expect(await enqueue({ ownerId: u.id })).toEqual({ created: 0, suppressed: 0 });
	});
});

describe('daily mute (A21)', () => {
	it('suppresses only the muted task normal notifications; errors and other tasks still notify', async () => {
		const u = await createUser();
		await updateSettings(u.id, { pushEnabled: true });
		await registerPushSubscription(u.id, fakeSubscription(), null);
		const t1 = await createTask(u.id);
		const t2 = await createTask(u.id);
		await muteToday(u.id, t1.id);
		expect(await enqueue({ ownerId: u.id, taskId: t1.id, event: 'zero_result' })).toEqual({ created: 0, suppressed: 1 });
		expect(await enqueue({ ownerId: u.id, taskId: t1.id, event: 'error', severity: 'error' })).toEqual({
			created: 1,
			suppressed: 0
		});
		expect(await enqueue({ ownerId: u.id, taskId: t2.id })).toEqual({ created: 1, suppressed: 0 });
		const rows = await rowsFor(u.id);
		expect(rows.find((r) => r.taskId === t1.id && r.severity === 'normal')!.status).toBe('suppressed');
	});

	it('mute expires at the next KST midnight (23:59:59 muted, 00:00 not)', async () => {
		const u = await createUser();
		await updateSettings(u.id, { pushEnabled: true });
		await registerPushSubscription(u.id, fakeSubscription(), null);
		const task = await createTask(u.id);
		const { muteUntil } = await muteToday(u.id, task.id, new Date('2026-11-02T01:00:00Z'));
		expect(muteUntil.toISOString()).toBe('2026-11-02T15:00:00.000Z');
		expect(await enqueue({ ownerId: u.id, taskId: task.id }, new Date('2026-11-02T14:59:59Z'))).toEqual({
			created: 0,
			suppressed: 1
		});
		expect(await enqueue({ ownerId: u.id, taskId: task.id }, new Date('2026-11-02T15:00:00Z'))).toEqual({
			created: 1,
			suppressed: 0
		});
	});

	it('cannot mute another owner task', async () => {
		const a = await createUser();
		const b = await createUser();
		const task = await createTask(a.id);
		await expect(muteToday(b.id, task.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
	});
});

describe('delivery failures (A23) [mock transports]', () => {
	it('SMTP failure -> delivery_failed (redacted) while push is still sent once; no retry, no recursive error mail', async () => {
		const u = await createUser();
		await withVerifiedSender(u.id);
		await useLoginEmail(u.id);
		await registerPushSubscription(u.id, fakeSubscription(), 'pc');
		await updateSettings(u.id, { emailEnabled: true, pushEnabled: true });
		const runId = randomUUID();
		expect(await enqueue({ ownerId: u.id, runId, event: 'error', severity: 'error' })).toEqual({
			created: 2,
			suppressed: 0
		});
		const { t, calls } = mockTransports({ mailError: 'mock SMTP 535 auth failed password=hunter2' });
		expect(await deliverPending({ transports: t })).toEqual({ sent: 1, failed: 1 });
		const rows = await rowsFor(u.id);
		const email = rows.find((r) => r.channel === 'email')!;
		const push = rows.find((r) => r.channel === 'push')!;
		expect(email.status).toBe('delivery_failed');
		expect(email.attempts).toBe(1);
		expect(email.lastError).toContain('535');
		expect(email.lastError).not.toContain('hunter2');
		expect(push.status).toBe('sent');
		expect(push.attempts).toBe(1);

		expect(await deliverPending({ transports: t })).toEqual({ sent: 0, failed: 0 });
		expect(calls.mail).toHaveLength(1);
		expect(calls.push).toHaveLength(1);
		expect(await rowsFor(u.id)).toHaveLength(2);
		const listed = await listNotifications(u.id);
		expect(listed.find((n) => n.channel === 'email')!.status).toBe('delivery_failed');
	});

	it('push 410 marks the subscription expired and the row delivery_failed (mock)', async () => {
		const u = await createUser();
		await updateSettings(u.id, { pushEnabled: true });
		const sub = await registerPushSubscription(u.id, fakeSubscription(), null);
		await enqueue({ ownerId: u.id });
		const { t } = mockTransports({ pushStatus: 410 });
		expect(await deliverPending({ transports: t })).toEqual({ sent: 0, failed: 1 });
		const [s] = await db().select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, sub.id));
		expect(s!.status).toBe('expired');
		expect(await enqueue({ ownerId: u.id })).toEqual({ created: 0, suppressed: 0 });
	});

	it('missing sender -> delivery_failed "sender not configured" (mock)', async () => {
		const u = await createUser();
		await useLoginEmail(u.id);
		await updateSettings(u.id, { emailEnabled: true });
		await enqueue({ ownerId: u.id });
		const { t, calls } = mockTransports();
		expect(await deliverPending({ transports: t })).toEqual({ sent: 0, failed: 1 });
		expect(calls.mail).toHaveLength(0);
		const [row] = await rowsFor(u.id);
		expect(row!.lastError).toContain('sender not configured');
	});
});

describe('outbox idempotency and payload', () => {
	it('same run event enqueued twice creates rows once', async () => {
		const u = await createUser();
		await updateSettings(u.id, { pushEnabled: true });
		await registerPushSubscription(u.id, fakeSubscription(), null);
		await registerPushSubscription(u.id, fakeSubscription(), null);
		const runId = randomUUID();
		expect(await enqueue({ ownerId: u.id, runId })).toEqual({ created: 2, suppressed: 0 });
		expect(await enqueue({ ownerId: u.id, runId })).toEqual({ created: 0, suppressed: 0 });
		expect(await rowsFor(u.id)).toHaveLength(2);
	});

	it('stored payload has no host paths or tokens; push rows carry no body', async () => {
		const u = await createUser();
		await useLoginEmail(u.id);
		await withVerifiedSender(u.id);
		await registerPushSubscription(u.id, fakeSubscription(), null);
		await updateSettings(u.id, { emailEnabled: true, pushEnabled: true });
		await enqueue({
			ownerId: u.id,
			body: 'output /data/runs/abc/report.xlsx Bearer abcdefghijklmnopqrstuv',
			link: '/runs/abc?token=secret-token'
		});
		const rows = await rowsFor(u.id);
		const json = JSON.stringify(rows.map((r) => r.payload));
		expect(json).not.toContain('/data/');
		expect(json).not.toContain('abcdefghijklmnopqrstuv');
		expect(json).not.toContain('secret-token');
		expect(rows.find((r) => r.channel === 'push')!.payload).not.toHaveProperty('body');
	});
});

describe('resend is an explicit owner-scoped action [mock transports]', () => {
	it('other owner gets NOT_FOUND; owner resends once', async () => {
		const u = await createUser();
		const other = await createUser();
		await updateSettings(u.id, { pushEnabled: true });
		await registerPushSubscription(u.id, fakeSubscription(), null);
		await enqueue({ ownerId: u.id });
		await deliverPending({ transports: mockTransports({ pushStatus: 500 }).t });
		const [row] = await rowsFor(u.id);
		expect(row!.status).toBe('delivery_failed');

		await expect(resend(other.id, row!.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
		await expect(resend(u.id, row!.id)).resolves.toEqual({ id: row!.id, status: 'pending' });
		const { t, calls } = mockTransports();
		expect(await deliverPending({ transports: t })).toEqual({ sent: 1, failed: 0 });
		expect(calls.push).toHaveLength(1);
		const [after] = await rowsFor(u.id);
		expect(after!.status).toBe('sent');
		expect(after!.attempts).toBe(2);
		await expect(resend(u.id, row!.id)).rejects.toBeInstanceOf(AppError);
	});
});

describe('sender profiles and recipient verification [mock transports]', () => {
	it('From is the verified profile from_address; unverified/foreign profiles cannot be selected', async () => {
		const u = await createUser();
		const other = await createUser();
		const foreign = await createSmtpProfile(other.id, {
			label: 'other',
			host: 'smtp.example.test',
			port: 465,
			secure: true,
			username: 'o',
			password: 'pw-value',
			fromAddress: 'other@example.test'
		});
		await verifySmtpProfile(foreign.id, mockTransports().t);
		await expect(updateSettings(u.id, { smtpProfileId: foreign.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });

		const unverified = await createSmtpProfile(u.id, {
			label: 'x',
			host: 'smtp.example.test',
			port: 587,
			secure: false,
			username: 'x',
			password: 'pw',
			fromAddress: 'x@example.test'
		});
		await expect(updateSettings(u.id, { smtpProfileId: unverified.id })).rejects.toMatchObject({ code: 'CONFLICT' });
		await expect(verifySmtpProfile(unverified.id, mockTransports({ verifyError: 'mock auth failed' }).t)).rejects.toMatchObject({
			code: 'DELIVERY_FAILED'
		});

		const shared = await createSmtpProfile(null, {
			label: 'shared',
			host: 'smtp.example.test',
			port: 465,
			secure: true,
			username: 'admin',
			password: 'pw-shared',
			fromAddress: 'noreply@example.test'
		});
		await verifySmtpProfile(shared.id, mockTransports().t, { actorOwnerId: null });
		const list = await listSenderProfiles(u.id);
		expect(list.map((p) => p.id)).toContain(shared.id);
		expect(list.map((p) => p.id)).not.toContain(foreign.id);
		expect(JSON.stringify(list)).not.toMatch(/pw-shared|encrypted|password/i);
		expect(list.find((p) => p.id === shared.id)!.host).toBeUndefined();

		await updateSettings(u.id, { smtpProfileId: shared.id, emailEnabled: true });
		await useLoginEmail(u.id);
		await enqueue({ ownerId: u.id });
		const { t, calls } = mockTransports();
		expect(await deliverPending({ transports: t })).toEqual({ sent: 1, failed: 0 });
		expect(calls.mail[0]!.msg.from).toBe('noreply@example.test');
		expect(calls.mail[0]!.sender.password).toBe('pw-shared');
	});

	it('new recipient is used only after the emailed 6-digit code is confirmed; code stored only as hash', async () => {
		const u = await createUser();
		await withVerifiedSender(u.id);
		const { t, calls } = mockTransports();
		await startRecipientChange(u.id, 'new-recipient@example.test', t);
		expect(calls.mail).toHaveLength(1);
		expect(calls.mail[0]!.msg.to).toBe('new-recipient@example.test');
		const code = /(\d{6})/.exec(calls.mail[0]!.msg.text)![1]!;
		const [row] = await db().select().from(schema.notificationSettings).where(eq(schema.notificationSettings.ownerId, u.id));
		expect(row!.challengeHash).toMatch(/^\d+:[0-9a-f]{64}$/);
		expect(Object.values(row!).map(String)).not.toContain(code);
		expect((await getSettings(u.id)).recipientVerified).toBe(false);

		const wrong = code === '000000' ? '111111' : '000000';
		await expect(confirmRecipientChange(u.id, wrong)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
		const s = await confirmRecipientChange(u.id, code);
		expect(s.recipientEmail).toBe('new-recipient@example.test');
		expect(s.recipientVerified).toBe(true);
		expect(s.pendingRecipient).toBeNull();
	});

	it('expired codes are rejected', async () => {
		const u = await createUser();
		await withVerifiedSender(u.id);
		const { t, calls } = mockTransports();
		const now = new Date();
		await startRecipientChange(u.id, 'later@example.test', t, { now });
		const code = /(\d{6})/.exec(calls.mail[0]!.msg.text)![1]!;
		await expect(confirmRecipientChange(u.id, code, { now: new Date(now.getTime() + 16 * 60_000) })).rejects.toMatchObject({
			code: 'VALIDATION_FAILED'
		});
		expect((await getSettings(u.id)).recipientVerified).toBe(false);
	});
});

describe('push subscriptions', () => {
	it('never takes over another owner subscription (per-owner rows); unregister is owner-scoped', async () => {
		const a = await createUser();
		const b = await createUser();
		const sub = fakeSubscription();
		const reg = await registerPushSubscription(a.id, sub, 'a-device');
		// a second account on the same browser gets its OWN row; A's row is untouched
		const regB = await registerPushSubscription(b.id, sub, 'b-device');
		expect(regB.id).not.toBe(reg.id);
		const [row] = await db().select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, reg.id));
		expect(row!.ownerId).toBe(a.id);
		expect(row!.deviceLabel).toBe('a-device');
		expect(row!.encryptedSubscription).not.toContain(sub.endpoint);

		// re-register by the same owner refreshes the same row
		expect((await registerPushSubscription(a.id, sub, 'renamed')).id).toBe(reg.id);

		await expect(unregisterPushSubscription(b.id, reg.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
		await unregisterPushSubscription(a.id, reg.id);
		const [revoked] = await db()
			.select()
			.from(schema.pushSubscriptions)
			.where(and(eq(schema.pushSubscriptions.id, reg.id), eq(schema.pushSubscriptions.status, 'revoked')));
		expect(revoked!.encryptedSubscription).toBe('');
	});
});
