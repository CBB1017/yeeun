import type { PageLoad } from './$types';
import { load as loadApi } from '#lib/client/api.ts';
import type { DriveConnection, Grant } from '#lib/client/types.ts';

export const load: PageLoad = async ({ fetch, depends }) => {
	depends('app:files');
	const [connection, grants] = await Promise.all([loadApi<DriveConnection | null>(fetch, '/api/drive/connection'), loadApi<Grant[]>(fetch, '/api/drive/grants')]);
	return { connection, grants };
};
