import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Already signed in: go to the workspace. */
export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/');
	return {};
};
