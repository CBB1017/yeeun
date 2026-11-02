import { z } from 'zod';
import { body, handler, ok, requireAdmin, requireMutation } from '#lib/server/http.ts';
import { invite, listInvitations } from '#lib/server/auth/users.ts';

export const GET = handler(async (event) => {
	requireAdmin(event);
	return ok(event, await listInvitations());
});
export const POST = handler(async (event) => {
	const u = requireMutation(event);
	requireAdmin(event);
	const b = await body(event, z.strictObject({ email: z.string().max(320), role: z.enum(['admin', 'user']).default('user') }));
	return ok(event, await invite(u.id, b.email, b.role), 201);
});
