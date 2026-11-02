import type { PageLoad } from './$types';
import { load as loadApi } from '#lib/client/api.ts';
import type { PublicRun, TaskDetail } from '#lib/client/types.ts';

export const load: PageLoad = async ({ fetch, params, depends }) => {
	depends('app:task');
	const [detail, runs] = await Promise.all([loadApi<TaskDetail>(fetch, `/api/tasks/${params.id}`), loadApi<PublicRun[]>(fetch, `/api/tasks/${params.id}/runs`)]);
	return { detail, runs };
};
