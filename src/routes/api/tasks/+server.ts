import { handler, ok, requireUser } from '#lib/server/http.ts';
import { listTasks } from '#lib/server/tasks/service.ts';

export const GET = handler(async (event) => ok(event, await listTasks(requireUser(event).id)));
