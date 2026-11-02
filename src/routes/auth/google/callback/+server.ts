import { redirect, type RequestHandler } from '@sveltejs/kit';
import { FLOW_COOKIE, finishFlow, openFlow } from '#lib/server/auth/google-oidc.ts';
import { SESSION_COOKIE, createSession, signInWithGoogle } from '#lib/server/auth/users.ts';
import { config } from '#lib/server/config.ts';
import { isAppError } from '#lib/server/errors.ts';

export const GET: RequestHandler = async ({ url, cookies }) => {
	let target = '/';
	try {
		const flow = openFlow(cookies.get(FLOW_COOKIE), 'login');
		cookies.delete(FLOW_COOKIE, { path: '/' });
		const r = await finishFlow('login', url, flow);
		const user = await signInWithGoogle(r);
		const s = await createSession(user.id);
		cookies.set(SESSION_COOKIE, s.token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: config().publicOrigin.startsWith('https://'),
			expires: s.expiresAt
		});
	} catch (e) {
		target = `/login?error=${isAppError(e) ? e.code : 'AUTH_REQUIRED'}`;
	}
	redirect(303, target);
};
