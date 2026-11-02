import { handler, ok, requireMutation } from '#lib/server/http.ts';
import { deleteUpload } from '#lib/server/uploads/service.ts';

export const DELETE = handler(async (event) => ok(event, await deleteUpload(requireMutation(event).id, event.params.id!)));
