import type { PageLoad } from './$types';
import { load as loadApi } from '#lib/client/api.ts';
import type { Capabilities, Invitation, StorageRoot } from '#lib/client/types.ts';

export const load: PageLoad = async ({ fetch, depends, parent }) => {
	depends('app:admin');
	const { me } = await parent();
	if (me.user.role !== 'admin') return { allowed: false as const };
	const [invitations, capabilities, roots] = await Promise.all([
		loadApi<Invitation[]>(fetch, '/api/admin/invitations'),
		loadApi<Capabilities>(fetch, '/api/admin/capabilities'),
		loadApi<StorageRoot[]>(fetch, '/api/admin/settings/storage')
	]);
	return { allowed: true as const, invitations, capabilities, roots };
};
