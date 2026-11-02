import { handler, ok, requireMutation } from '#lib/server/http.ts';
import { removeGrant } from '#lib/server/drive/service.ts';

export const DELETE = handler(async (event) => ok(event, await removeGrant(requireMutation(event).id, event.params.id!)));
