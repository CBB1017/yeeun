import { redirect, type RequestHandler } from '@sveltejs/kit';
import { FLOW_COOKIE, startFlow } from '#lib/server/auth/google-oidc.ts';
import { googleConfigured, config } from '#lib/server/config.ts';

export const GET: RequestHandler = async ({ cookies }) => {
	if (!googleConfigured()) redirect(303, '/login?error=NOT_CONFIGURED');
	const { url, sealed } = await startFlow('login');
	cookies.set(FLOW_COOKIE, sealed, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: config().publicOrigin.startsWith('https://'),
		maxAge: 600
	});
	redirect(303, url, { external: ['https://accounts.google.com'] });
};
