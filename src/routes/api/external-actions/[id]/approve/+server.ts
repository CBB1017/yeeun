import { z } from 'zod';
import { body, handler, ok, requireMutation } from '#lib/server/http.ts';
import { approveAction } from '#lib/server/external/actions.ts';

export const POST = handler(async (event) => {
	const u = requireMutation(event);
	const b = await body(event, z.strictObject({ approvalHash: z.string().regex(/^[0-9a-f]{64}$/) }));
	return ok(event, await approveAction(u.id, event.params.id!, b.approvalHash));
});
