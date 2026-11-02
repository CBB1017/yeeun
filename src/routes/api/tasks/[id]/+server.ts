import { z } from 'zod';
import { body, handler, ok, requireMutation, requireUser } from '#lib/server/http.ts';
import { getTask, setTaskStatus } from '#lib/server/tasks/service.ts';

export const GET = handler(async (event) => ok(event, await getTask(requireUser(event).id, event.params.id!)));
export const PATCH = handler(async (event) => {
	const u = requireMutation(event);
	const b = await body(event, z.strictObject({ status: z.enum(['active', 'paused', 'archived']) }));
	return ok(event, await setTaskStatus(u.id, event.params.id!, b.status));
});
