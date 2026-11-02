import { z } from 'zod';
import { body, handler, ok, requireMutation } from '#lib/server/http.ts';
import { registerPushSubscription, unregisterPushSubscription } from '#lib/server/notify/settings.ts';

export const POST = handler(async (event) => {
	const u = requireMutation(event);
	const b = await body(
		event,
		z.strictObject({
			subscription: z.object({ endpoint: z.url().max(2000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }),
			deviceLabel: z.string().max(100).nullable().optional()
		})
	);
	return ok(event, await registerPushSubscription(u.id, b.subscription, b.deviceLabel ?? null), 201);
});
export const DELETE = handler(async (event) => {
	const u = requireMutation(event);
	const b = await body(event, z.strictObject({ id: z.uuid() }));
	await unregisterPushSubscription(u.id, b.id);
	return ok(event, { removed: true });
});
