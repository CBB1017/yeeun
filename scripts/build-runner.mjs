// Bundles only the cli-runner (node builtins, no node_modules at runtime).
import { build } from 'esbuild';
await build({
	entryPoints: { 'cli-runner': 'src/server-entry/cli-runner.ts' },
	outdir: 'dist',
	bundle: true,
	platform: 'node',
	target: 'node26',
	format: 'esm',
	logLevel: 'info'
});
