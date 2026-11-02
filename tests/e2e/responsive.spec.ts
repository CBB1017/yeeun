import { test, expect, ids, pageAs, noPageOverflow, axe, shot } from './fixtures.ts';

/**
 * A31: 375/768/1024/1440 — no document-level horizontal overflow, wide tables
 * scroll inside their own container, axe has no serious/critical violations.
 * Full-page screenshots are written to $E2E_ARTIFACT_DIR/screens.
 */
const WIDTHS = [375, 768, 1024, 1440];

test('responsive layout, screenshots and axe on every screen', async ({ browser }) => {
	test.setTimeout(240_000);
	const s = ids();
	// A draft to render the plan editor.
	const setup = await pageAs(browser, 'admin');
	const me = await (await setup.page.request.get('/api/me')).json();
	const d = await setup.page.request.post('/api/task-drafts', {
		headers: { 'x-csrf-token': me.data.csrfToken, origin: process.env.E2E_BASE_URL ?? 'http://localhost:3000' },
		data: { prompt: '마감일 목록에서 월~목 10시, 14시에 30일 이내 마감 과제를 엑셀로 정리해서 메일로 보내줘', timezone: 'Asia/Seoul' }
	});
	const draftId = (await d.json()).data.id as string;
	await setup.ctx.close();

	const pages: { name: string; path: string; ready: string; who?: 'admin' | 'reviewer' }[] = [
		{ name: 'home', path: '/', ready: 'prompt-input' },
		{ name: 'files', path: '/files', ready: 'grant-list' },
		{ name: 'draft', path: `/drafts/${draftId}`, ready: 'draft-actions' },
		{ name: 'task', path: `/tasks/${s.taskDeadline}`, ready: 'task-upcoming' },
		{ name: 'run-completed', path: `/runs/${s.runCompleted}`, ready: 'records-table' },
		{ name: 'run-review', path: `/runs/${s.runReview}`, ready: 'disagreement' },
		{ name: 'run-failed', path: `/runs/${s.runFailed}`, ready: 'error-view' },
		{ name: 'run-queued', path: `/runs/${s.runQueued}`, ready: 'waiting-reason' },
		{ name: 'settings', path: '/settings', ready: 'email-section' },
		{ name: 'admin', path: '/admin', ready: 'invitations' }
	];

	for (const w of WIDTHS) {
		const { ctx, page } = await pageAs(browser, 'admin', { width: w, height: w < 768 ? 812 : 900 });
		for (const p of pages) {
			await page.goto(p.path);
			await expect(page.getByTestId(p.ready).first()).toBeVisible();
			await noPageOverflow(page);
			await shot(page, `${p.name}-${w}`);
			if (w === 375 || w === 1440) await axe(page);
		}
		// Records table keeps all columns: it scrolls inside its container on narrow screens.
		await page.goto(`/runs/${s.runCompleted}`);
		const wrap = page.getByTestId('records-table-wrap');
		await expect(page.getByTestId('records-table').locator('thead th')).toHaveCount(9);
		if (w <= 768) {
			const sc = await wrap.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
			expect(sc.sw).toBeGreaterThan(sc.cw);
		}
		// Evidence: right column on wide desktop, dialog (sheet) otherwise.
		await page.getByTestId('row-evidence').first().click();
		if (w >= 1280) {
			await expect(page.getByTestId('evidence-aside')).toContainText('레코드 (모든 열)');
		} else {
			await expect(page.getByRole('dialog', { name: '근거' })).toBeVisible();
			await noPageOverflow(page);
			await shot(page, `evidence-open-${w}`);
			if (w === 375) await axe(page);
			await page.keyboard.press('Escape');
		}
		if (w === 375) {
			await page.getByTestId('menu-button').click();
			const nav = page.getByRole('dialog', { name: '메뉴' });
			await expect(nav.getByRole('link', { name: '알림·설정' })).toBeVisible();
			await shot(page, 'nav-drawer-375');
			await page.keyboard.press('Escape');
			await expect(page.getByTestId('menu-button')).toBeFocused();
		}
		await ctx.close();
	}
});

test('login page responsive + axe', async ({ browser }) => {
	for (const w of WIDTHS) {
		const ctx = await browser.newContext({ viewport: { width: w, height: 800 } });
		const page = await ctx.newPage();
		await page.goto('/login?error=NOT_CONFIGURED');
		await expect(page.getByTestId('login-error')).toBeVisible();
		await noPageOverflow(page);
		await shot(page, `login-${w}`);
		if (w === 375 || w === 1440) await axe(page);
		await ctx.close();
	}
});

test('touch targets: primary controls are at least 44px tall on mobile', async ({ browser }) => {
	const { ctx, page } = await pageAs(browser, 'admin', { width: 375, height: 812 });
	await page.goto(`/runs/${ids().runReview}`);
	await expect(page.getByTestId('request-review')).toBeVisible();
	for (const id of ['request-review', 'cancel-review', 'menu-button']) {
		const box = await page.getByTestId(id).boundingBox();
		expect(box!.height, id).toBeGreaterThanOrEqual(44);
	}
	await ctx.close();
});
