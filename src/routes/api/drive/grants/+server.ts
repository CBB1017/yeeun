import { z } from 'zod';
import { body, handler, ok, requireMutation, requireUser } from '#lib/server/http.ts';
import { addGrants, searchGrants } from '#lib/server/drive/service.ts';

export const GET = handler(async (event) => ok(event, await searchGrants(requireUser(event).id, '')));
export const POST = handler(async (event) => {
	const u = requireMutation(event);
	const b = await body(
		event,
		z.strictObject({
			fileIds: z
				.array(z.string().regex(/^[A-Za-z0-9_-]{10,200}$/))
				.min(1)
				.max(50)
		})
	);
	return ok(event, await addGrants(u.id, b.fileIds), 201);
});
