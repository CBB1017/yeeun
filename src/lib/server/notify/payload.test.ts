import { describe, expect, it } from 'vitest';
import { buildEmailPayload, emailMessage, safeLink, sanitizeText, toPushPayload } from './payload';

const ORIGIN = 'https://app.example.test';

describe('notification payload redaction', () => {
	it('removes tokens, credentials and host paths from text', () => {
		const raw = [
			'Bearer abcdef0123456789',
			'access_token=ya29.secretvalue',
			'refresh_token: 1//0abcdefghijklmnopqrstuvwxyz',
			'password=hunter2',
			'key sk-ABCDEFGHIJKLMNOP',
			'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefgh',
			'see /data/runs/0001/output.csv',
			'auth at /cli-auth/claude/.credentials.json',
			'win C:\\Users\\me\\Documents\\secret.xlsx',
			'home /home/node/.codex/auth.json',
			'file:///etc/passwd',
			'https://app.example.test/runs/1?token=abc123&code=999'
		].join('\n');
		const out = sanitizeText(raw, 5000);
		for (const leaked of [
			'abcdef0123456789',
			'ya29.secretvalue',
			'1//0abcdefghijklmnopqrstuvwxyz',
			'hunter2',
			'sk-ABCDEFGHIJKLMNOP',
			'eyJhbGciOiJIUzI1NiJ9',
			'/data/runs',
			'/cli-auth/',
			'C:\\Users',
			'/home/node',
			'/etc/passwd',
			'abc123',
			'code=999'
		]) {
			expect(out).not.toContain(leaked);
		}
		expect(out).toContain('[path]');
	});

	it('keeps ordinary business text intact', () => {
		const text = '마감 30일 이내 과제 3건 (2026-11-02 ~ 2026-12-01), error code: 535';
		expect(sanitizeText(text, 5000)).toBe(text);
	});

	it('truncates long titles and strips control characters', () => {
		expect(sanitizeText('a\u0000b\u0007c', 50)).toBe('abc');
		expect(sanitizeText('x'.repeat(500), 200)).toHaveLength(200);
	});
});

describe('authenticated link only', () => {
	it('keeps same-origin app paths and drops query/fragment', () => {
		expect(safeLink('/runs/0190-abc?token=x#access_token=y', ORIGIN)).toBe(`${ORIGIN}/runs/0190-abc`);
		expect(safeLink(`${ORIGIN}/tasks/1`, ORIGIN)).toBe(`${ORIGIN}/tasks/1`);
	});
	it('replaces foreign, protocol-relative and credentialed links with the app root', () => {
		expect(safeLink('https://evil.example/x', ORIGIN)).toBe(`${ORIGIN}/`);
		expect(safeLink('//evil.example/x', ORIGIN)).toBe(`${ORIGIN}/`);
		expect(safeLink('javascript:alert(1)', ORIGIN)).toBe(`${ORIGIN}/`);
		expect(safeLink('https://user:pw@app.example.test/x', ORIGIN)).toBe(`${ORIGIN}/`);
	});
});

describe('channel payloads', () => {
	const p = buildEmailPayload(
		{
			taskId: '01900000-0000-7000-8000-000000000001',
			event: 'zero_result',
			severity: 'normal',
			title: '마감 과제 알림',
			body: '0건입니다. 상세: /data/runs/1/report.json Bearer abcdefghijklmnop',
			link: '/runs/abc?session=zzz'
		},
		ORIGIN
	);
	it('push payload carries only title/status/link (no body)', () => {
		const push = toPushPayload(p);
		expect(Object.keys(push).sort()).toEqual(['link', 'mutable', 'severity', 'status', 'title']);
		expect(JSON.stringify(push)).not.toContain('0건입니다');
		expect(push.link).toBe(`${ORIGIN}/runs/abc`);
	});
	it('email body is redacted and offers the daily mute action for normal task notifications', () => {
		const m = emailMessage(p);
		expect(m.text).not.toContain('/data/runs');
		expect(m.text).not.toContain('abcdefghijklmnop');
		expect(m.text).toContain('오늘은 알림 더 표시 안함');
		expect(m.subject).toContain('0건');
	});
	it('error notifications are not mutable', () => {
		const e = buildEmailPayload({ taskId: 't', event: 'error', severity: 'error', title: 'x', body: '', link: '/' }, ORIGIN);
		expect(e.mutable).toBe(false);
		expect(emailMessage(e).text).not.toContain('오늘은 알림 더 표시 안함');
	});
});
