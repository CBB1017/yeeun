import type { Handle } from '@sveltejs/kit/hooks';
import { randomUUID } from 'node:crypto';
import { SESSION_COOKIE, userForSession } from '#lib/server/auth/users.ts';

const SECURITY_HEADERS: Record<string, string> = {
	'x-content-type-options': 'nosniff',
	// Cross-origin requests carry only the origin (no path/query). Google Picker needs it:
	// an API key restricted to website referrers rejects requests with no Referer.
	'referrer-policy': 'strict-origin-when-cross-origin',
	'x-frame-options': 'DENY',
	'permissions-policy': 'camera=(), microphone=(), geolocation=()',
	'cross-origin-opener-policy': 'same-origin-allow-popups'
};

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.requestId = randomUUID();
	event.locals.user = null;
	const path = event.url.pathname;
	if (!path.startsWith('/health')) {
		try {
			event.locals.user = await userForSession(event.cookies.get(SESSION_COOKIE));
		} catch {
			event.locals.user = null;
		}
	}
	const response = await resolve(event);
	for (const [k, v] of Object.entries(SECURITY_HEADERS)) response.headers.set(k, v);
	response.headers.set('x-request-id', event.locals.requestId);
	return response;
};
