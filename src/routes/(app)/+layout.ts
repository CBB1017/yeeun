import type { LayoutLoad } from './$types';
import { load as loadApi, setCsrfToken } from '#lib/client/api.ts';
import type { Me } from '#lib/client/types.ts';

// Authenticated workspace renders in the browser: times are shown in the
// browser's time zone and live run state comes from SSE.
export const ssr = false;

export const load: LayoutLoad = async ({ fetch, depends }) => {
	depends('app:me');
	const me = await loadApi<Me>(fetch, '/api/me');
	setCsrfToken(me.csrfToken);
	return { me };
};
