import { z } from 'zod';
import { body, handler, ok, requireAdmin, requireMutation } from '#lib/server/http.ts';
import { activateRoot, listRoots, migrateFiles, requestRoot } from '#lib/server/storage-admin.ts';

export const GET = handler(async (event) => {
	requireAdmin(event);
	return ok(event, await listRoots());
});
export const PATCH = handler(async (event) => {
	const u = requireMutation(event);
	requireAdmin(event);
	const b = await body(
		event,
		z.discriminatedUnion('op', [
			z.strictObject({ op: z.literal('request'), hostLabel: z.string().min(1).max(500), containerPath: z.string().min(2).max(200) }),
			z.strictObject({ op: z.literal('activate'), id: z.uuid() }),
			z.strictObject({ op: z.literal('migrate'), fromRootId: z.uuid(), toRootId: z.uuid() })
		])
	);
	if (b.op === 'request') return ok(event, await requestRoot(u.id, b.hostLabel, b.containerPath));
	if (b.op === 'activate') return ok(event, await activateRoot(u.id, b.id));
	return ok(event, await migrateFiles(u.id, b.fromRootId, b.toRootId));
});
