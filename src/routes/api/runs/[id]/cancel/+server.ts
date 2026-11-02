import { handler, ok, requireMutation } from '#lib/server/http.ts';
import { cancelRun } from '#lib/server/runs/service.ts';
import { publicRun } from '#lib/server/runs/views.ts';

export const POST = handler(async (event) => ok(event, publicRun(await cancelRun(requireMutation(event).id, event.params.id!))));
