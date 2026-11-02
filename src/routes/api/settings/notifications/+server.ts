import { z } from 'zod';
import { body, handler, ok, requireMutation, requireUser } from '#lib/server/http.ts';
import { getSettings, listSenderProfiles, updateSettings } from '#lib/server/notify/settings.ts';
import { listNotifications } from '#lib/server/notify/deliver.ts';

export const GET = handler(async (event) => {
	const u = requireUser(event);
	return ok(event, {
		settings: await getSettings(u.id),
		senders: await listSenderProfiles(u.id),
		recent: await listNotifications(u.id, { limit: 30 })
	});
});
export const PATCH = handler(async (event) => {
	const u = requireMutation(event);
	const b = await body(
		event,
		z.strictObject({
			emailEnabled: z.boolean().optional(),
			pushEnabled: z.boolean().optional(),
			smtpProfileId: z.uuid().nullable().optional()
		})
	);
	return ok(event, await updateSettings(u.id, b));
});
