import { handler, ok, requireMutation } from '#lib/server/http.ts';
import { rejectAction } from '#lib/server/external/actions.ts';

export const POST = handler(async (event) => ok(event, await rejectAction(requireMutation(event).id, event.params.id!)));
