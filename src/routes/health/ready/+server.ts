import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { loadMasterKey } from '#lib/server/crypto.ts';

/** Ready = DB reachable, migrations applied, active storage root, master key configured. */
export const GET = async () => {
	try {
		loadMasterKey();
		await db().execute(sql`select 1 from drizzle.__drizzle_migrations limit 1`);
		const r = await db().execute(sql`select 1 from storage_roots where status = 'active' limit 1`);
		if (!r.rows.length) throw new Error('no storage root');
		return json({ status: 'ready' });
	} catch {
		return json({ status: 'not_ready' }, { status: 503 });
	}
};
