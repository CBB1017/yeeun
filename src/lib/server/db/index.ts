import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { databaseUrl } from '../config';

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type DbOrTx = DB | Tx;

let pool: pg.Pool | undefined;
let database: DB | undefined;

export function getPool(): pg.Pool {
	if (!pool) {
		pool = new pg.Pool({ connectionString: databaseUrl(), max: Number(process.env.DB_POOL_MAX ?? 10) });
		pool.on('error', (err) => console.error('[db] idle client error', err.message));
	}
	return pool;
}

export function db(): DB {
	if (!database) database = drizzle(getPool(), { schema });
	return database;
}

export async function closeDb(): Promise<void> {
	const p = pool;
	pool = undefined;
	database = undefined;
	await p?.end();
}

export { schema };
