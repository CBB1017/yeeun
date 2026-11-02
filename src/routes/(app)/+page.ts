import type { PageLoad } from './$types';
import { load as loadApi } from '#lib/client/api.ts';
import type { PublicRun, TaskListItem, Grant } from '#lib/client/types.ts';
import type { UploadLimits, UploadedOriginal } from '#lib/shared/uploads.ts';

export const load: PageLoad = async ({ fetch }) => {
	const [tasks, runs, grants, uploads] = await Promise.all([
		loadApi<TaskListItem[]>(fetch, '/api/tasks'),
		loadApi<PublicRun[]>(fetch, '/api/runs'),
		loadApi<Grant[]>(fetch, '/api/drive/grants'),
		loadApi<{ limits: UploadLimits; items: UploadedOriginal[] }>(fetch, '/api/uploads')
	]);
	return { tasks, runs, grantCount: grants.length, uploadLimits: uploads.limits };
};
