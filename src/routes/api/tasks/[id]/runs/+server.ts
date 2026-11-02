import { and, desc, eq } from 'drizzle-orm';
import { handler, idempotencyKey, ok, requireMutation, requireUser } from '#lib/server/http.ts';
import { createManualRun } from '#lib/server/runs/service.ts';
import { publicRun } from '#lib/server/runs/views.ts';
import { db, schema } from '#lib/server/db/index.ts';

export const GET = handler(async (event) => {
	const u = requireUser(event);
	const rows = await db()
		.select()
		.from(schema.runs)
		.where(and(eq(schema.runs.ownerId, u.id), eq(schema.runs.taskId, event.params.id!)))
		.orderBy(desc(schema.runs.createdAt))
		.limit(100);
	return ok(event, rows.map(publicRun));
});
export const POST = handler(async (event) => {
	const u = requireMutation(event);
	const r = await createManualRun(u.id, event.params.id!, idempotencyKey(event));
	return ok(event, { run: publicRun(r.run), duplicate: r.duplicate }, r.duplicate ? 200 : 201);
});
