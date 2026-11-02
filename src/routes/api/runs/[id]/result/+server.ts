import { handler, ok, requireUser } from '#lib/server/http.ts';
import { runResult } from '#lib/server/runs/views.ts';

export const GET = handler(async (event) => ok(event, await runResult(requireUser(event).id, event.params.id!)));
