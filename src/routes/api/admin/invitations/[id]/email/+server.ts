import { z } from 'zod';
import { body, handler, ok, requireAdmin, requireMutation } from '#lib/server/http.ts';
import { sendInvitationEmail } from '#lib/server/auth/invitation-email.ts';

export const POST = handler(async (event) => {
	const admin = requireMutation(event);
	requireAdmin(event);
	const input = await body(event, z.strictObject({ expectedAttempts: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }));
	return ok(event, await sendInvitationEmail(admin.id, event.params.id!, input.expectedAttempts));
});
