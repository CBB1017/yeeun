import { z } from 'zod';
import { body, handler, ok, requireMutation } from '#lib/server/http.ts';
import { createDraft } from '#lib/server/tasks/service.ts';
import { MAX_ATTACHMENTS } from '#lib/shared/uploads.ts';

export const POST = handler(async (event) => {
	const u = requireMutation(event);
	const b = await body(
		event,
		z.strictObject({
			prompt: z.string().min(1).max(20000),
			timezone: z.string().min(1).max(100),
			upload_ids: z.array(z.uuid()).max(MAX_ATTACHMENTS).optional()
		})
	);
	return ok(event, await createDraft(u.id, b.prompt, b.timezone, b.upload_ids ?? []), 201);
});
