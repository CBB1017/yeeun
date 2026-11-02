import { handler, ok, requireUser } from '#lib/server/http.ts';
import { listRuns } from '#lib/server/runs/views.ts';

export const GET = handler(async (event) => ok(event, await listRuns(requireUser(event).id)));
