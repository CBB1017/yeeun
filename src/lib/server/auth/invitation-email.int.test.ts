import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, useTestDatabase } from '../../../../tests/setup/db';
import { closeDb, db, schema } from '../db';
import { resetConfigForTests } from '../config';
import { createSmtpProfile, updateSettings, verifySmtpProfile } from '../notify/settings';
import type { MailMessage, Transports } from '../notify/transports';
import { invite } from './users';
import { sendInvitationEmail } from './invitation-email';

useTestDatabase();

const createdUsers: string[] = [];
async function testUser(role: 'admin' | 'user' = 'user') {
	const user = await createUser(role);
	createdUsers.push(user.id);
	return user;
}

// All delivery is mocked. No live SMTP settings or messages are used.
beforeAll(() => {
	for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM', 'SMTP_USER', 'SMTP_PASSWORD']) delete process.env[key];
	process.env.PUBLIC_ORIGIN = 'https://app.example.test';
	resetConfigForTests();
});
afterAll(async () => {
	// Do not leave test admins behind: another suite tests first-admin bootstrap.
	if (createdUsers.length) {
		await db().delete(schema.auditEvents).where(inArray(schema.auditEvents.actorId, createdUsers));
		await db().delete(schema.invitations).where(inArray(schema.invitations.invitedBy, createdUsers));
		await db().delete(schema.notificationSettings).where(inArray(schema.notificationSettings.ownerId, createdUsers));
		await db().delete(schema.smtpProfiles).where(inArray(schema.smtpProfiles.ownerId, createdUsers));
		await db().delete(schema.users).where(inArray(schema.users.id, createdUsers));
	}
	await closeDb();
});

function transport(error?: string) {
	const mail: MailMessage[] = [];
	const t: Transports = {
		async sendMail(_sender, msg) {
			mail.push(msg);
			if (error) throw new Error(error);
		},
		async sendPush() {
			throw new Error('unexpected push');
		},
		async verifyMail() {}
	};
	return { t, mail };
}

async function adminWithSender() {
	const admin = await testUser('admin');
	const { t } = transport();
	const profile = await createSmtpProfile(admin.id, {
		label: 'test sender',
		host: 'smtp.example.test',
		port: 587,
		secure: false,
		username: 'test',
		password: 'test-password',
		fromAddress: 'sender@example.test'
	});
	await verifySmtpProfile(profile.id, t, { actorOwnerId: admin.id });
	await updateSettings(admin.id, { smtpProfileId: profile.id });
	return admin;
}

async function activeInvitation(adminId: string) {
	const [row] = await db()
		.insert(schema.invitations)
		.values({ email: `${randomUUID()}@example.test`, invitedBy: adminId })
		.returning();
	return row!;
}

describe('invitation email delivery (mock SMTP, isolated PostgreSQL)', () => {
	it('creates the invitation and sends login instructions exactly once', async () => {
		const admin = await adminWithSender();
		const { t, mail } = transport();
		const email = `${randomUUID()}@example.test`;
		const result = await invite(admin.id, email.toUpperCase(), 'user', t);
		expect(result).toMatchObject({ email, status: 'active', emailStatus: 'sent', emailAttempts: 1, emailLastError: null });
		expect(result.emailSentAt).toBeInstanceOf(Date);
		expect(mail).toHaveLength(1);
		expect(mail[0]).toMatchObject({ to: email, from: 'sender@example.test' });
		expect(mail[0]!.text).toContain('https://app.example.test/login');
		expect(mail[0]!.text).not.toContain('test-password');
		await expect(invite(admin.id, email, 'user', t)).rejects.toMatchObject({ code: 'CONFLICT' });
		expect(mail).toHaveLength(1);
	});

	it('retains the invitation and redacts failure, with only explicit retry', async () => {
		const admin = await adminWithSender();
		const failed = transport('SMTP failed password=private-value');
		const result = await invite(admin.id, `${randomUUID()}@example.test`, 'user', failed.t);
		expect(result).toMatchObject({ status: 'active', emailStatus: 'failed', emailAttempts: 1 });
		expect(result.emailLastError).not.toContain('private-value');
		expect(failed.mail).toHaveLength(1);
		const retry = transport();
		const sent = await sendInvitationEmail(admin.id, result.id, 1, retry.t);
		expect(sent).toMatchObject({ emailStatus: 'sent', emailAttempts: 2, emailLastError: null });
		const duplicate = await sendInvitationEmail(admin.id, result.id, 1, retry.t);
		expect(duplicate.emailAttempts).toBe(2);
		expect(retry.mail).toHaveLength(1);
	});

	it('missing sender fails without losing the valid invitation', async () => {
		const admin = await testUser('admin');
		const { t, mail } = transport();
		const result = await invite(admin.id, `${randomUUID()}@example.test`, 'user', t);
		expect(result).toMatchObject({ status: 'active', emailStatus: 'failed', emailAttempts: 1, emailLastError: 'sender not configured' });
		expect(mail).toHaveLength(0);
	});

	it('historical invitations stay unsent until an explicit send', async () => {
		const admin = await adminWithSender();
		const invitation = await activeInvitation(admin.id);
		const { t, mail } = transport();
		expect(invitation).toMatchObject({ emailStatus: 'not_requested', emailAttempts: 0, emailSentAt: null });
		await sendInvitationEmail(admin.id, invitation.id, 0, t);
		expect(mail).toHaveLength(1);
	});

	it('allows only one concurrent SMTP attempt for the same revision', async () => {
		const admin = await adminWithSender();
		const invitation = await activeInvitation(admin.id);
		let release!: () => void;
		let entered!: () => void;
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const started = new Promise<void>((r) => {
			entered = r;
		});
		let calls = 0;
		const { t } = transport();
		t.sendMail = async () => {
			calls++;
			entered();
			await gate;
		};
		const first = sendInvitationEmail(admin.id, invitation.id, 0, t);
		await started;
		try {
			await expect(sendInvitationEmail(admin.id, invitation.id, 0, t)).rejects.toMatchObject({ code: 'CONFLICT' });
		} finally {
			release();
		}
		await first;
		expect(calls).toBe(1);
	});

	it('blocks revoked/accepted invitations and non-admin callers', async () => {
		const admin = await adminWithSender();
		const user = await testUser();
		const { t, mail } = transport();
		for (const status of ['revoked', 'accepted']) {
			const invitation = await activeInvitation(admin.id);
			await db().update(schema.invitations).set({ status }).where(eq(schema.invitations.id, invitation.id));
			await expect(sendInvitationEmail(admin.id, invitation.id, 0, t)).rejects.toMatchObject({ code: 'CONFLICT' });
		}
		const invitation = await activeInvitation(admin.id);
		await expect(sendInvitationEmail(user.id, invitation.id, 0, t)).rejects.toMatchObject({ code: 'NOT_FOUND' });
		await expect(invite(user.id, `${randomUUID()}@example.test`, 'user', t)).rejects.toMatchObject({ code: 'NOT_FOUND' });
		expect(mail).toHaveLength(0);
	});
});
