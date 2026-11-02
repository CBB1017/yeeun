import { handler, ok, requireAdmin, requireMutation } from '#lib/server/http.ts';
import { revokeInvitation } from '#lib/server/auth/users.ts';

export const DELETE = handler(async (event) => {
	const u = requireMutation(event);
	requireAdmin(event);
	return ok(event, await revokeInvitation(u.id, event.params.id!));
});
