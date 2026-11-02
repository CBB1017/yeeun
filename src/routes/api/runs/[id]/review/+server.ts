import { handler, ok, requireMutation } from '#lib/server/http.ts';
import { requestReview } from '#lib/server/runs/service.ts';
import { publicRun } from '#lib/server/runs/views.ts';

export const POST = handler(async (event) => {
	const r = await requestReview(requireMutation(event).id, event.params.id!);
	return ok(event, { run: publicRun(r.run), duplicate: r.duplicate });
});
