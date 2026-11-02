import { handler, ok, requireMutation } from '#lib/server/http.ts';
import { muteToday } from '#lib/server/notify/settings.ts';

export const POST = handler(async (event) => ok(event, await muteToday(requireMutation(event).id, event.params.id!)));
