import { z } from 'zod';
import { body, handler, ok, requireMutation } from '#lib/server/http.ts';
import { createDraft } from '#lib/server/tasks/service.ts';

export const POST = handler(async (event) => {
	const u = requireMutation(event);
	const b = await body(event, z.strictObject({ prompt: z.string().min(1).max(20000), timezone: z.string().min(1).max(100) }));
	return ok(event, await createDraft(u.id, b.prompt, b.timezone), 201);
});
