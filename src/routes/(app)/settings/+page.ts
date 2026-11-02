import type { PageLoad } from './$types';
import { load as loadApi } from '#lib/client/api.ts';
import type { NotificationItem, NotificationSettings, SenderProfile } from '#lib/client/types.ts';

export const load: PageLoad = async ({ fetch, depends }) => {
	depends('app:settings');
	const s = await loadApi<{ settings: NotificationSettings; senders: SenderProfile[]; recent: NotificationItem[] }>(fetch, '/api/settings/notifications');
	return s;
};
