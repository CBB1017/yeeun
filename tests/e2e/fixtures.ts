import { test as base, expect, type Page, type Browser } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import type { SeedIds } from './seed.ts';

export const STATE_DIR = process.env.E2E_STATE_DIR ?? '/tmp/yeeun-e2e';
export const SHOT_DIR = path.join(process.env.E2E_ARTIFACT_DIR ?? 'test-results', 'screens');

export function ids(): SeedIds {
	return JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'seed.json'), 'utf8')) as SeedIds;
}

export function stateFor(who: 'admin' | 'other' | 'reviewer') {
	return path.join(STATE_DIR, `${who}.json`);
}

export async function pageAs(browser: Browser, who: 'admin' | 'other' | 'reviewer', viewport = { width: 1440, height: 900 }) {
	const ctx = await browser.newContext({ storageState: stateFor(who), viewport, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
	return { ctx, page: await ctx.newPage() };
}

export async function noPageOverflow(page: Page) {
	const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
	expect(r.sw, `document scrollWidth ${r.sw} > clientWidth ${r.cw}`).toBeLessThanOrEqual(r.cw);
}

export async function axe(page: Page) {
	const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
	const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
	expect(bad.map((v) => `${v.id}: ${v.help} -> ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
}

export async function shot(page: Page, name: string) {
	fs.mkdirSync(SHOT_DIR, { recursive: true });
	await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
}

export const test = base.extend<{ admin: Page }>({
	admin: async ({ browser }, use) => {
		const { ctx, page } = await pageAs(browser, 'admin');
		await use(page);
		await ctx.close();
	}
});
export { expect };
