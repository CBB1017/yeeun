import { redirect, type RequestHandler } from '@sveltejs/kit';
import { FLOW_COOKIE, startFlow } from '#lib/server/auth/google-oidc.ts';
import { config, googleConfigured } from '#lib/server/config.ts';

export const GET: RequestHandler = async ({ locals, cookies }) => {
	if (!locals.user) redirect(303, '/login');
	if (!googleConfigured()) redirect(303, '/files?error=NOT_CONFIGURED');
	const { url, sealed } = await startFlow('drive', { userId: locals.user.id, loginHint: locals.user.email });
	cookies.set(FLOW_COOKIE, sealed, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: config().publicOrigin.startsWith('https://'),
		maxAge: 600
	});
	redirect(303, url);
};
