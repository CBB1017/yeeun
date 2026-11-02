import pg from 'pg';
import { databaseUrl } from './config';

/** One LISTEN connection per web process fans run_events notifications out to SSE streams. */

type Fn = () => void;
const subs = new Map<string, Set<Fn>>();
let client: pg.Client | undefined;
let connecting: Promise<void> | undefined;

async function ensure() {
	if (client) return;
	connecting ??= (async () => {
		const c = new pg.Client({ connectionString: databaseUrl() });
		c.on('notification', (n) => {
			try {
				const { run_id } = JSON.parse(n.payload ?? '{}') as { run_id?: string };
				if (run_id) subs.get(run_id)?.forEach((f) => f());
			} catch {
				/* ignore */
			}
		});
		c.on('error', () => {
			client = undefined;
			connecting = undefined;
			// Wake everyone so they re-read from their cursor after reconnecting.
			for (const set of subs.values()) set.forEach((f) => f());
		});
		await c.connect();
		await c.query('listen run_events');
		client = c;
	})();
	try {
		await connecting;
	} finally {
		connecting = undefined;
	}
}

export async function subscribeRunEvents(runId: string, fn: Fn): Promise<() => void> {
	await ensure();
	let set = subs.get(runId);
	if (!set) subs.set(runId, (set = new Set()));
	set.add(fn);
	return () => {
		set!.delete(fn);
		if (!set!.size) subs.delete(runId);
	};
}
