import { z } from 'zod';
import { body, handler, ok, requireMutation, requireUser } from '#lib/server/http.ts';
import { getDraft, updateDraft } from '#lib/server/tasks/service.ts';

export const GET = handler(async (event) => ok(event, await getDraft(requireUser(event).id, event.params.id!)));
export const PATCH = handler(async (event) => {
	const u = requireMutation(event);
	const b = await body(event, z.strictObject({ expectedRevision: z.number().int(), plan: z.unknown(), timezoneConfirmed: z.boolean() }));
	return ok(event, await updateDraft(u.id, event.params.id!, b.expectedRevision, b.plan, b.timezoneConfirmed));
});
