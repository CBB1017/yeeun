import { z } from 'zod';
import { body, handler, ok, requireMutation } from '#lib/server/http.ts';
import { confirmDraft } from '#lib/server/tasks/service.ts';

export const POST = handler(async (event) => {
	const u = requireMutation(event);
	const b = await body(event, z.strictObject({ revision: z.number().int() }));
	return ok(event, await confirmDraft(u.id, event.params.id!, b.revision));
});
