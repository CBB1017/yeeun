import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { sql } from 'drizzle-orm';
import { config, databaseUrl } from '../lib/server/config';
import { db, closeDb, schema } from '../lib/server/db';
import { loadMasterKey } from '../lib/server/crypto';
import { ensureActiveRoot, probeWritable } from '../lib/server/storage';
import { claimNext, heartbeat, recoverInterrupted } from '../lib/server/queue/dispatcher';
import { executeRun, type ExecContext } from '../lib/server/runs/executor';
import { schedulerTick } from '../lib/server/schedule/scheduler';
import { cleanupPending, cleanupRun } from '../lib/server/retention/cleanup';
import { deliverPending, failStaleSending } from '../lib/server/notify/deliver';
import { executeApprovedActions } from '../lib/server/external/actions';
import { cliRunner } from '../lib/server/cli/client';
import { redact } from '../lib/server/errors';

const workerId = `${hostname()}-${randomBytes(4).toString('hex')}`;
const HEALTH_FILE = process.env.WORKER_HEALTH_FILE ?? '/tmp/worker-health.json';
const cfg = config();

interface Slot {
	controller: AbortController;
	reason: 'cancelled' | 'timeout' | 'shutdown' | null;
	timer: NodeJS.Timeout;
}
const slots = new Map<string, Slot>();
let stopping = false;
let ready = false;
let boss: PgBoss | undefined;
let listener: pg.Client | undefined;

function log(...a: unknown[]) {
	console.log('[worker]', ...a);
}

async function writeHealth() {
	await writeFile(HEALTH_FILE, JSON.stringify({ at: Date.now(), ready: ready && !stopping, active: slots.size })).catch(() => {});
}

async function dispatchLoop() {
	if (stopping || !ready) return;
	while (!stopping && slots.size < cfg.taskConcurrency) {
		const claimed = await claimNext(workerId).catch((e) => {
			log('claim failed', redact((e as Error).message));
			return null;
		});
		if (!claimed) return;
		const controller = new AbortController();
		const slot: Slot = {
			controller,
			reason: null,
			timer: setTimeout(() => abort(claimed.id, 'timeout'), cfg.taskTimeoutSeconds * 1000)
		};
		slots.set(claimed.id, slot);
		const ctx: ExecContext = { signal: controller.signal, abortReason: () => slot.reason };
		log(`run ${claimed.id} round ${claimed.round} started`);
		void executeRun(claimed.id, ctx)
			.catch((e) => log('executor crashed', redact((e as Error).message)))
			.finally(() => {
				clearTimeout(slot.timer);
				slots.delete(claimed.id);
				log(`run ${claimed.id} finished`);
				void dispatchLoop();
			});
	}
}

function abort(runId: string, reason: 'cancelled' | 'timeout' | 'shutdown') {
	const s = slots.get(runId);
	if (!s || s.reason) return;
	s.reason = reason;
	s.controller.abort();
}

async function heartbeatLoop() {
	try {
		const { cancelled } = await heartbeat(workerId, [...slots.keys()]);
		cancelled.forEach((id) => abort(id, 'cancelled'));
		const interrupted = await recoverInterrupted();
		if (interrupted.length) log(`marked interrupted: ${interrupted.length}`);
	} catch (e) {
		log('heartbeat failed', redact((e as Error).message));
	}
}

async function refreshCapabilities() {
	let value: Record<string, unknown>;
	try {
		const st = await cliRunner().status();
		value = { checked_at: new Date().toISOString(), runner: 'reachable', ...st };
	} catch (e) {
		value = { checked_at: new Date().toISOString(), runner: 'unreachable', error: redact((e as Error).message) };
	}
	value.storage_writable = await probeWritable(cfg.fileStorageRoot);
	await db()
		.insert(schema.appSettings)
		.values({ key: 'capability_status', value })
		.onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date() } })
		.catch(() => {});
}

async function main() {
	loadMasterKey();
	await db().execute(sql`select 1 from drizzle.__drizzle_migrations limit 1`);
	await ensureActiveRoot();
	boss = new PgBoss({ connectionString: databaseUrl(), schema: 'pgboss', migrate: false, supervise: true, schedule: true });
	boss.on('error', (e) => log('pg-boss error', redact(e.message)));
	await boss.start();
	await boss.schedule('scheduler-tick', '* * * * *', {}, { tz: 'UTC' });
	await boss.work('scheduler-tick', { batchSize: 1 }, async () => {
		const r = await schedulerTick();
		if (r.created) log(`scheduled runs created: ${r.created}`);
	});
	await boss.work<{ runId: string }>('snapshot-cleanup', { batchSize: 1 }, async ([job]) => {
		if (job) await cleanupRun(job.data.runId);
	});
	await boss.work('notify-deliver', { batchSize: 1 }, async () => {
		await deliverPending({ limit: 50 });
	});
	await boss.work('run-dispatch', { batchSize: 1 }, async () => {
		await dispatchLoop();
	});

	listener = new pg.Client({ connectionString: databaseUrl() });
	await listener.connect();
	await listener.query('listen run_dispatch; listen notify_deliver; listen snapshot_cleanup; listen external_action');
	listener.on('notification', (n) => {
		if (n.channel === 'run_dispatch') void dispatchLoop();
		if (n.channel === 'notify_deliver') void boss?.send('notify-deliver', {}, { singletonKey: 'deliver', singletonSeconds: 2 });
		if (n.channel === 'snapshot_cleanup' && n.payload) void boss?.send('snapshot-cleanup', { runId: n.payload });
		if (n.channel === 'external_action')
			void executeApprovedActions().catch((e) => log('external action failed', redact((e as Error).message)));
	});

	// Startup: expired leases from a previous process become interrupted (no rerun);
	// missed schedules are coalesced by the first scheduler tick.
	await recoverInterrupted();
	await schedulerTick();
	await refreshCapabilities();
	ready = true;
	await writeHealth();
	log(`ready as ${workerId} (concurrency ${cfg.taskConcurrency})`);

	setInterval(() => void dispatchLoop(), 3000).unref();
	setInterval(() => void heartbeatLoop(), cfg.heartbeatSeconds * 1000).unref();
	setInterval(() => void writeHealth(), 5000).unref();
	setInterval(() => void refreshCapabilities(), 60_000).unref();
	setInterval(() => void deliverPending({ limit: 50 }).catch(() => {}), 10_000).unref();
	setInterval(() => void failStaleSending().catch(() => {}), 60_000).unref();
	setInterval(() => void cleanupPending().catch(() => {}), 600_000).unref();
	void dispatchLoop();
}

async function shutdown(signal: string) {
	if (stopping) return;
	stopping = true;
	log(`${signal}: stop claiming; interrupting ${slots.size} active run(s)`);
	await writeHealth();
	for (const id of slots.keys()) abort(id, 'shutdown');
	const deadline = Date.now() + 20_000;
	while (slots.size && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
	await listener?.end().catch(() => {});
	await boss?.stop({ graceful: true, close: true, timeout: 5000 }).catch(() => {});
	await closeDb().catch(() => {});
	process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

main().catch(async (e) => {
	console.error('[worker] fatal:', redact((e as Error).message));
	await closeDb().catch(() => {});
	process.exit(1);
});
