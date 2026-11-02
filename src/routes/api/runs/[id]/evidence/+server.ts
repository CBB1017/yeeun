import { handler, ok, requireUser } from '#lib/server/http.ts';
import { runEvidence } from '#lib/server/runs/views.ts';

export const GET = handler(async (event) => ok(event, await runEvidence(requireUser(event).id, event.params.id!)));
