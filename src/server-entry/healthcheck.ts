import { readFile } from 'node:fs/promises';

/** Container healthcheck: worker writes a heartbeat file every few seconds once ready. */
const target = process.argv[2] ?? 'worker';
const file = process.env.WORKER_HEALTH_FILE ?? '/tmp/worker-health.json';

try {
	if (target !== 'worker') throw new Error('unknown target');
	const j = JSON.parse(await readFile(file, 'utf8')) as { at: number; ready: boolean };
	if (!j.ready || Date.now() - j.at > 60_000) process.exit(1);
	process.exit(0);
} catch {
	process.exit(1);
}
