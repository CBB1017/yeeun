import { handler, ok, requireAdmin } from '#lib/server/http.ts';
import { capabilitySummary } from '#lib/server/capabilities.ts';

export const GET = handler(async (event) => {
	requireAdmin(event);
	return ok(event, await capabilitySummary(true));
});
