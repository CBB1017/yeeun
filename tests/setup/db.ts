import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { setMasterKeyForTests } from '../../src/lib/server/crypto';
import { db, schema } from '../../src/lib/server/db';

/** Per-file helpers for integration tests (DB created by global-db.ts). */
export function useTestDatabase() {
	const pw = readFileSync(process.env.POSTGRES_PASSWORD_FILE ?? '/run/secrets/postgres_password', 'utf8').trim();
	process.env.DATABASE_URL = `postgres://${process.env.POSTGRES_USER ?? 'yeeun'}:${encodeURIComponent(pw)}@${process.env.POSTGRES_HOST ?? 'db'}:5432/${process.env.TEST_DATABASE_NAME ?? 'yeeun_test'}`;
	setMasterKeyForTests(randomBytes(32));
}

let n = 0;
export async function createUser(role: 'admin' | 'user' = 'user') {
	n += 1;
	const tag = `${Date.now()}${n}${randomBytes(3).toString('hex')}`;
	const [u] = await db()
		.insert(schema.users)
		.values({ googleSub: `sub-${tag}`, email: `u${tag}@example.test`, emailVerified: true, role, name: `User ${n}` })
		.returning();
	return u!;
}

export async function truncateAll() {
	await db().execute(sql`
		do $$ declare r record; begin
		for r in select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations' loop
			execute 'truncate table ' || quote_ident(r.tablename) || ' cascade';
		end loop; end $$;`);
}
