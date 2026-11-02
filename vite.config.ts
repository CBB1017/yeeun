import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
			},
			adapter: adapter({ out: 'build' })
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'unit',
					environment: 'node',
					include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
					exclude: ['src/**/*.int.test.ts', 'tests/integration/**']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'integration',
					environment: 'node',
					include: ['src/**/*.int.test.ts', 'tests/integration/**/*.test.ts'],
					globalSetup: ['tests/setup/global-db.ts'],
					fileParallelism: false,
					testTimeout: 120_000,
					hookTimeout: 120_000
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'live',
					environment: 'node',
					include: ['tests/live/**/*.test.ts'],
					globalSetup: ['tests/setup/global-db.ts'],
					fileParallelism: false,
					testTimeout: 1_800_000,
					hookTimeout: 120_000
				}
			}
		]
	}
});
