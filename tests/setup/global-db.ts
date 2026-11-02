import pg from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

/**
 * Integration tests run against a separate database (default yeeun_test) on
 * the Compose PostgreSQL. It is dropped and re-migrated once per test run.
 */
export default async function setup() {
	const host = process.env.POSTGRES_HOST ?? 'db';
	const user = process.env.POSTGRES_USER ?? 'yeeun';
	const pw = readFileSync(process.env.POSTGRES_PASSWORD_FILE ?? '/run/secrets/postgres_password', 'utf8').trim();
	const name = process.env.TEST_DATABASE_NAME ?? 'yeeun_test';
	if (!/^[a-z_][a-z0-9_]*$/.test(name) || !name.includes('test')) throw new Error('unsafe test database name');
	const admin = new pg.Client({ host, user, password: pw, database: 'postgres' });
	await admin.connect();
	await admin.query(`drop database if exists ${name} with (force)`);
	await admin.query(`create database ${name}`);
	await admin.end();
	const url = `postgres://${user}:${encodeURIComponent(pw)}@${host}:5432/${name}`;
	process.env.DATABASE_URL = url;
	const pool = new pg.Pool({ connectionString: url });
	await migrate(drizzle(pool), { migrationsFolder: path.resolve('drizzle') });
	await pool.end();
}
