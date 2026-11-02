import { redirect, type RequestHandler } from '@sveltejs/kit';
import { FLOW_COOKIE, finishFlow, openFlow } from '#lib/server/auth/google-oidc.ts';
import { saveConnection } from '#lib/server/drive/service.ts';
import { isAppError } from '#lib/server/errors.ts';

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	if (!locals.user) redirect(303, '/login');
	let target = '/files?connected=1';
	try {
		const flow = openFlow(cookies.get(FLOW_COOKIE), 'drive');
		cookies.delete(FLOW_COOKIE, { path: '/' });
		if (flow.userId !== locals.user.id) throw new Error('flow user mismatch');
		const r = await finishFlow('drive', url, flow);
		await saveConnection(locals.user.id, r);
	} catch (e) {
		target = `/files?error=${isAppError(e) ? e.code : 'DRIVE_REAUTH_REQUIRED'}`;
	}
	redirect(303, target);
};
