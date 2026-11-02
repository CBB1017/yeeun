import { test, expect, ids, pageAs, type Page } from './fixtures.ts';

async function csrf(page: Page): Promise<string> {
	const r = await page.request.get('/api/me');
	expect(r.ok()).toBeTruthy();
	return (await r.json()).data.csrfToken as string;
}
const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

test.describe('task authoring', () => {
	test('home -> draft -> answer question -> confirm and run now (queued behind own review, A16)', async ({ admin }) => {
		const s = ids();
		await admin.goto('/');
		await expect(admin.getByRole('heading', { name: '내 업무' })).toBeVisible();
		await admin.getByTestId('prompt-input').fill('마감일 목록에서 오늘부터 30일 이내 마감 과제를 정리해줘');
		await admin.getByTestId('prompt-submit').click();
		await admin.waitForURL(/\/drafts\/[0-9a-f-]{36}$/);

		// Interpreted plan: the only matching allowed file is selected; the column is asked.
		await expect(admin.getByTestId('questions')).toContainText('어느 열의 날짜로 30일 범위');
		await expect(admin.locator('#sources').getByText('파일 1. 마감일 목록.xlsx', { exact: true })).toBeVisible();
		await expect(admin.getByTestId('confirm-save')).toBeDisabled();
		await admin.getByTestId('q-column-0').fill('마감일');
		await admin.getByTestId('save-draft').click();
		await expect(admin.getByTestId('save-message')).toContainText('저장했습니다');
		await expect(admin.getByTestId('questions')).toHaveCount(0);

		// Distinguish "save" vs "save and run now".
		await expect(admin.getByTestId('confirm-save')).toHaveText('업무 저장');
		await expect(admin.getByTestId('confirm-run')).toHaveText('저장하고 지금 실행');
		await admin.getByTestId('confirm-run').click();
		await admin.waitForURL(/\/runs\/[0-9a-f-]{36}$/);
		const waiting = admin.getByTestId('waiting-reason');
		await expect(waiting).toContainText('검토를 기다리고 있어');
		await expect(admin.getByTestId('open-blocking-run')).toHaveAttribute('href', `/runs/${s.runReview}`);
		await expect(admin.getByTestId('run-progress')).toContainText('대기열');
	});

	test('recurring schedule editor has no default days/times and previews next 3 occurrences', async ({ admin }) => {
		const token = await csrf(admin);
		const r = await admin.request.post('/api/task-drafts', { headers: { 'x-csrf-token': token, origin: ORIGIN }, data: { prompt: '매출 2026 파일의 합계를 알려줘', timezone: 'Asia/Seoul' } });
		expect(r.status()).toBe(201);
		const id = (await r.json()).data.id;
		await admin.goto(`/drafts/${id}`);
		await admin.getByTestId('sched-recurring').check();
		await expect(admin.getByText('아직 시각이 없습니다. 기본 시각을 넣지 않습니다.')).toBeVisible();
		await expect(admin.locator('#wd-1')).not.toBeChecked();
		await admin.getByTestId('save-draft').click();
		await expect(admin.getByRole('alert').filter({ hasText: '고칠 항목' })).toContainText('반복할 요일');
		await admin.locator('#wd-1').check();
		await admin.locator('#new-time').fill('10:00');
		await admin.getByRole('button', { name: '시각 추가' }).click();
		await expect(admin.getByTestId('next-occurrences').locator('li')).toHaveCount(3);
	});
});

test.describe('run detail states', () => {
	test('completed: original headers, warnings, version, downloads, evidence panel (desktop)', async ({ admin }) => {
		const s = ids();
		await admin.goto(`/runs/${s.runCompleted}`);
		await expect(admin.getByTestId('result-summary')).toContainText('3건');
		const headers = admin.getByTestId('records-table').locator('thead th');
		await expect(headers).toHaveText(['상세·근거', '과제명', '마감일', '주관 기관', '지원 금액(만원)', '담당자', '진행 상태', '비고', '접수 시스템'].map((h) => new RegExp(h.replace(/[()]/g, '\\$&'))));
		await expect(admin.getByTestId('warnings')).toContainText('수식 실행 방지');
		await expect(admin.getByTestId('version-info')).toContainText('로컬 스냅샷 SHA-256');
		await expect(admin.getByTestId('version-info')).toContainText('원본 스냅샷 정리됨; 분석 당시 근거 보관');
		await expect(admin.getByText('밀린 예약 실행')).toBeVisible();
		await expect(admin.getByRole('img', { name: /미리보기/ })).toBeVisible();

		const dl = admin.getByTestId('download-csv');
		const href = await dl.getAttribute('href');
		const resp = await admin.request.get(href!);
		expect(resp.status()).toBe(200);
		expect(resp.headers()['content-disposition']).toContain('attachment');
		expect((await resp.body()).toString('utf8')).toContain("'=SUM");

		await admin.getByTestId('row-evidence').first().click();
		const aside = admin.getByTestId('evidence-aside');
		await expect(aside).toContainText('레코드 (모든 열)');
		await expect(aside).toContainText('접수 시스템');
		await expect(aside.getByTestId('snapshot-deleted').first()).toBeVisible();
		await expect(aside).toContainText('현재 버전일 수 있음');
		await expect(aside.getByRole('link', { name: /원본 Drive에서 열기/ }).first()).toHaveAttribute('href', /drive\.google\.com/);
	});

	test('awaiting review: both results side by side, differences and check failures', async ({ admin }) => {
		await admin.goto(`/runs/${ids().runReview}`);
		await expect(admin.getByTestId('review-needed')).toBeVisible();
		const d = admin.getByTestId('disagreement');
		await expect(d.getByRole('heading', { name: 'Claude' })).toBeVisible();
		await expect(d.getByRole('heading', { name: 'Codex' })).toBeVisible();
		await expect(d).toContainText('1234000');
		await expect(d).toContainText('1243000');
		await expect(admin.getByTestId('differences-table')).toContainText('claims.total_sales');
		await expect(d).toContainText('AGGREGATE_MISMATCH');
		await expect(admin.getByTestId('request-review')).toBeEnabled();
		await expect(admin.getByTestId('cancel-review')).toBeVisible();
	});

	test('failed: code, stage, no automatic retry, retained data, manual new run', async ({ admin }) => {
		await admin.goto(`/runs/${ids().runFailed}`);
		const v = admin.getByTestId('error-view');
		await expect(v).toContainText('USAGE_LIMIT');
		await expect(v).toContainText('CLI 분석');
		await expect(v).toContainText('자동 재시도하지 않음');
		await expect(v).toContainText('부분 결과');
		await admin.getByTestId('rerun').click();
		await expect(admin.getByTestId('confirm-rerun')).toContainText('새 실행');
		await admin.keyboard.press('Escape');
		await expect(admin.getByTestId('confirm-rerun')).toHaveCount(0);
	});

	test('queued run blocked by own review explains the lane and links to review', async ({ admin }) => {
		const s = ids();
		await admin.goto(`/runs/${s.runQueued}`);
		await expect(admin.getByTestId('waiting-reason')).toContainText('다른 사용자의 실행은');
		await admin.getByTestId('open-blocking-run').click();
		await admin.waitForURL(`**/runs/${s.runReview}`);
		await expect(admin.getByTestId('review-needed')).toBeVisible();
	});

	test('zero result offers "오늘은 알림 더 표시 안함" scoped to this task', async ({ admin }) => {
		await admin.goto(`/runs/${ids().runZero}`);
		await expect(admin.getByTestId('zero-result')).toContainText('0건');
		await admin.getByTestId('mute-today').click();
		await expect(admin.getByText(/KST\)까지 이 업무의 정상 알림을 숨깁니다/)).toBeVisible();
	});

	test('external action shows destination + file hash and can be rejected', async ({ admin }) => {
		await admin.goto(`/runs/${ids().runCompleted}`);
		const x = admin.getByTestId('external-action');
		await expect(x).toContainText('내 Drive / 보고서');
		await expect(x).toContainText('승인 대기');
		await x.getByTestId('reject-action').click();
		await expect(x).toContainText('거부됨');
	});
});

test.describe('evidence panel keyboard', () => {
	test('mobile: bottom sheet opens with Enter, traps focus, Escape returns focus', async ({ browser }) => {
		const { ctx, page } = await pageAs(browser, 'admin', { width: 375, height: 812 });
		await page.goto(`/runs/${ids().runCompleted}`);
		const btn = page.getByTestId('row-evidence').first();
		await btn.focus();
		await page.keyboard.press('Enter');
		const sheet = page.getByRole('dialog', { name: '근거' });
		await expect(sheet).toBeVisible();
		await expect(sheet).toContainText('레코드 (모든 열)');
		for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
		expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
		await page.keyboard.press('Escape');
		await expect(sheet).toHaveCount(0);
		await expect(btn).toBeFocused();
		await ctx.close();
	});

	test('desktop: right column receives focus and close returns it', async ({ admin }) => {
		await admin.goto(`/runs/${ids().runCompleted}`);
		const btn = admin.getByTestId('claim-evidence').first();
		await btn.focus();
		await admin.keyboard.press('Enter');
		await expect(admin.locator('#evidence-aside-title')).toBeFocused();
		await expect(admin.getByTestId('evidence-aside')).toContainText('deadline_count');
		await admin.keyboard.press('Tab');
		await expect(admin.getByTestId('evidence-close')).toBeFocused();
		await admin.keyboard.press('Enter');
		await expect(btn).toBeFocused();
		await expect(admin.getByTestId('evidence-aside')).toContainText('원본 위치와 발췌가 여기에 표시됩니다');
	});
});

test('keyboard-only review flow: evidence, then one review request (A12)', async ({ browser }) => {
	const s = ids();
	const { ctx, page } = await pageAs(browser, 'reviewer');
	await page.goto(`/runs/${s.runReviewerOwn}`);
	await expect(page.getByTestId('review-needed')).toBeVisible();
	await page.locator('body').click({ position: { x: 1, y: 1 } });
	const tabTo = async (testid: string) => {
		for (let i = 0; i < 120; i++) {
			await page.keyboard.press('Tab');
			if (await page.evaluate((t) => document.activeElement?.getAttribute('data-testid') === t, testid)) return;
		}
		throw new Error(`could not reach ${testid} by keyboard`);
	};
	await tabTo('request-review');
	await page.keyboard.press('Shift+Tab');
	await tabTo('cancel-review');
	await tabTo('claim-evidence');
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('evidence-aside')).toContainText('total_sales');
	await expect(page.getByTestId('evidence-aside')).toContainText('Drive 리비전');
	await page.keyboard.press('Tab');
	await page.keyboard.press('Enter'); // close evidence -> focus back on the claim button
	await expect(page.getByTestId('claim-evidence').first()).toBeFocused();

	// Back to the review action, request exactly once.
	for (let i = 0; i < 120; i++) {
		await page.keyboard.press('Shift+Tab');
		if (await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'request-review')) break;
	}
	await expect(page.getByTestId('request-review')).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('action-message')).toContainText('재검토(2차)를 요청했습니다');
	await expect(page.getByTestId('request-review')).toHaveCount(0);

	// A duplicate request (e.g. double click / retry) enqueues nothing.
	const token = await csrf(page);
	const dup = await page.request.post(`/api/runs/${s.runReviewerOwn}/review`, { headers: { 'x-csrf-token': token, origin: ORIGIN }, data: {} });
	expect(dup.status()).toBe(200);
	const body = await dup.json();
	expect(body.data.duplicate).toBe(true);
	expect(body.data.run.round).toBe(2);
	await ctx.close();
});

test("A02: another user's run, events and artifact are not found and leak nothing", async ({ admin, browser }) => {
	const s = ids();
	await admin.goto(`/runs/${s.runOther}`);
	await expect(admin.getByTestId('error-page')).toContainText('찾을 수 없습니다');
	await expect(admin.locator('body')).not.toContainText('비공개');
	const other = await pageAs(browser, 'other');
	for (const [who, p] of [
		['admin', `/api/runs/${s.runOther}`],
		['admin', `/api/runs/${s.runOther}/events`],
		['admin', `/api/runs/${s.runOther}/evidence`],
		['other', `/api/tasks/${s.taskDeadline}`],
		['other', `/api/runs/${s.runCompleted}/result`]
	] as const) {
		const r = await (who === 'admin' ? admin : other.page).request.get(p);
		expect(r.status(), p).toBe(404);
		expect(await r.text()).not.toContain('비공개');
	}
	const res = await admin.request.get(`/api/runs/${s.runCompleted}/result`);
	const artId = (await res.json()).data.artifacts[0].id as string;
	const dl = await other.page.request.get(`/api/artifacts/${artId}/download`);
	expect(dl.status()).toBe(404);
	expect(await dl.text()).not.toMatch(/\/data|users\//);
	await other.ctx.close();
});

test('settings: email and push toggles are independent', async ({ admin }) => {
	const get = async () => (await (await admin.request.get('/api/settings/notifications')).json()).data.settings as { emailEnabled: boolean; pushEnabled: boolean };
	await admin.goto('/settings');
	const email = admin.locator('#email-enabled');
	const push = admin.locator('#push-enabled');
	await expect(email).not.toBeChecked();
	await expect(push).not.toBeChecked();
	await email.check();
	await expect(email).toBeChecked();
	await expect.poll(get).toEqual(expect.objectContaining({ emailEnabled: true, pushEnabled: false }));
	await push.check();
	await expect.poll(get).toEqual(expect.objectContaining({ emailEnabled: true, pushEnabled: true }));
	await email.uncheck();
	await expect.poll(get).toEqual(expect.objectContaining({ emailEnabled: false, pushEnabled: true }));
	await expect(push).toBeChecked();
	await push.uncheck();
	await expect.poll(get).toEqual(expect.objectContaining({ emailEnabled: false, pushEnabled: false }));
	// Push state is explained without requesting permission on load.
	await expect(admin.getByTestId('push-section')).toContainText('이 버튼을 눌렀을 때만');
});

test('admin: create and revoke an invitation with confirmation', async ({ admin }) => {
	const email = `e2e-invitee-${Date.now()}@example.test`;
	await admin.goto('/admin');
	await expect(admin.getByTestId('capabilities')).toContainText('Claude');
	await admin.getByTestId('invite-email').fill(email);
	await admin.getByTestId('invite-submit').click();
	const row = admin.getByTestId('invitation-table').locator('tr', { hasText: email });
	await expect(row).toContainText('초대됨');
	await row.getByRole('button', { name: `${email} 초대 취소` }).click();
	const dlg = admin.getByTestId('confirm-revoke');
	await expect(dlg).toContainText(email);
	await dlg.getByRole('button', { name: '초대 취소' }).click();
	await expect(row).toContainText('취소됨');
});

test('admin page is not available to a regular user', async ({ browser }) => {
	const { ctx, page } = await pageAs(browser, 'other');
	await page.goto('/admin');
	await expect(page.getByTestId('error-page')).toContainText('찾을 수 없습니다');
	expect((await page.request.get('/api/admin/invitations')).status()).toBe(404);
	await ctx.close();
});

test('login page shows invitation error and shared-subscription notice', async ({ page }) => {
	await page.goto('/login?error=INVITATION_REQUIRED');
	await expect(page.getByTestId('login-error')).toContainText('초대되지 않은 계정');
	await expect(page.getByText(/구독/).first()).toBeVisible();
	await expect(page.getByRole('link', { name: 'Google 계정으로 로그인' })).toHaveAttribute('href', '/auth/google/start');
});
