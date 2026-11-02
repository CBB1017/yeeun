// Bundles non-SvelteKit entry points (worker, migrate, healthcheck) into dist/.
// They run next to node_modules, so packages stay external.
// The cli-runner is bundled separately by scripts/build-runner.mjs.
import { build } from 'esbuild';

await build({
	entryPoints: {
		worker: 'src/server-entry/worker.ts',
		migrate: 'src/server-entry/migrate.ts',
		healthcheck: 'src/server-entry/healthcheck.ts'
	},
	outdir: 'dist',
	bundle: true,
	platform: 'node',
	target: 'node26',
	format: 'esm',
	sourcemap: true,
	packages: 'external',
	logLevel: 'info'
});
