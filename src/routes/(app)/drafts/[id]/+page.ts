import type { PageLoad } from './$types';
import { load as loadApi } from '#lib/client/api.ts';
import type { Draft, Grant } from '#lib/client/types.ts';

export const load: PageLoad = async ({ fetch, params }) => {
	const [draft, grants] = await Promise.all([loadApi<Draft>(fetch, `/api/task-drafts/${params.id}`), loadApi<Grant[]>(fetch, '/api/drive/grants')]);
	return { draft, grants };
};
