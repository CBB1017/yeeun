import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PgBoss } from 'pg-boss';
import { db, closeDb, getPool } from '../lib/server/db';
import { databaseUrl } from '../lib/server/config';
import { ensureActiveRoot } from '../lib/server/storage';
import { QUEUE_NAMES, queueOptions } from '../lib/server/queue/names';

/** One-shot schema migration: app tables (Drizzle SQL) + pg-boss schema + queues. */
async function main() {
	const folder = process.env.MIGRATIONS_DIR ?? path.resolve('drizzle');
	const client = await getPool().connect();
	try {
		await client.query('select pg_advisory_lock(727001)');
		await migrate(db(), { migrationsFolder: folder });
		await ensureActiveRoot();
	} finally {
		await client.query('select pg_advisory_unlock(727001)').catch(() => {});
		client.release();
	}
	const boss = new PgBoss({ connectionString: databaseUrl(), schema: 'pgboss', migrate: true, supervise: false, schedule: false });
	boss.on('error', (e) => console.error('[migrate] pg-boss', e.message));
	await boss.start();
	for (const name of QUEUE_NAMES) {
		const existing = await boss.getQueue(name);
		if (!existing) await boss.createQueue(name, queueOptions(name));
		else {
			const { policy: _p, ...rest } = queueOptions(name);
			void _p;
			await boss.updateQueue(name, rest);
		}
	}
	await boss.stop({ graceful: true, close: true, timeout: 10_000 });
	await closeDb();
	console.log('[migrate] schema up to date');
}

main().catch(async (e) => {
	console.error('[migrate] failed:', e instanceof Error ? e.message : e);
	await closeDb().catch(() => {});
	process.exit(1);
});
