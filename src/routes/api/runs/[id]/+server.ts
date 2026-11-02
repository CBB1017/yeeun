import { handler, ok, requireUser } from '#lib/server/http.ts';
import { runDetail } from '#lib/server/runs/views.ts';

export const GET = handler(async (event) => ok(event, await runDetail(requireUser(event).id, event.params.id!)));
