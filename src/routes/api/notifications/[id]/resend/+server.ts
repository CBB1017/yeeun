import { handler, ok, requireMutation } from '#lib/server/http.ts';
import { resend } from '#lib/server/notify/deliver.ts';

export const POST = handler(async (event) => ok(event, await resend(requireMutation(event).id, event.params.id!)));
