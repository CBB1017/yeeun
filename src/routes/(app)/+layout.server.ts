import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/** Signed-in area: redirect to the login screen when there is no session. */
export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	return {};
};
