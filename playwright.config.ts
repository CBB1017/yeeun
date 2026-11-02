import { defineConfig, devices } from '@playwright/test';

/**
 * Browser E2E against the running Compose stack. Run inside the `e2e` service
 * (network_mode: service:web), so http://localhost:3000 is the web container and
 * the Origin matches PUBLIC_ORIGIN:
 *   docker compose --profile e2e run --rm e2e npx playwright test
 * Screenshots/traces go to $E2E_ARTIFACT_DIR (bind-mounted to /artifacts).
 */
const artifacts = process.env.E2E_ARTIFACT_DIR ?? 'test-results';

export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: /.*\.spec\.ts$/,
	globalSetup: './tests/e2e/global-setup.ts',
	globalTeardown: './tests/e2e/global-teardown.ts',
	outputDir: `${artifacts}/test-output`,
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: [['list'], ['html', { outputFolder: `${artifacts}/report`, open: 'never' }]],
	use: {
		baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
		locale: 'ko-KR',
		timezoneId: 'Asia/Seoul',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }]
});
