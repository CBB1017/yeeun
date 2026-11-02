import type { PageLoad } from './$types';
import { load as loadApi } from '#lib/client/api.ts';
import type { PublicRun, TaskListItem, Grant } from '#lib/client/types.ts';

export const load: PageLoad = async ({ fetch }) => {
	const [tasks, runs, grants] = await Promise.all([
		loadApi<TaskListItem[]>(fetch, '/api/tasks'),
		loadApi<PublicRun[]>(fetch, '/api/runs'),
		loadApi<Grant[]>(fetch, '/api/drive/grants')
	]);
	return { tasks, runs, grantCount: grants.length };
};
