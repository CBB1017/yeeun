import { handler, ok, requireUser } from '#lib/server/http.ts';
import { listNotifications } from '#lib/server/notify/deliver.ts';

export const GET = handler(async (event) => ok(event, await listNotifications(requireUser(event).id, { limit: 100 })));
