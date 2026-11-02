import { json, type RequestHandler } from '@sveltejs/kit';
import { SESSION_COOKIE, revokeSession } from '#lib/server/auth/users.ts';
import { handler, requireMutation } from '#lib/server/http.ts';

export const POST: RequestHandler = handler(async (event) => {
	const u = requireMutation(event);
	await revokeSession(u.sessionId);
	event.cookies.delete(SESSION_COOKIE, { path: '/' });
	return json({ data: { loggedOut: true }, request_id: event.locals.requestId });
});
