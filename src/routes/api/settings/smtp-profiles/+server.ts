import { z } from 'zod';
import { body, handler, ok, requireMutation, requireUser } from '#lib/server/http.ts';
import { createSmtpProfile, listSenderProfiles, verifySmtpProfile } from '#lib/server/notify/settings.ts';
import { AppError } from '#lib/server/errors.ts';

export const GET = handler(async (event) => ok(event, await listSenderProfiles(requireUser(event).id)));
/** Personal profile, or (admin only) a shared one. Secrets are never returned. */
export const POST = handler(async (event) => {
	const u = requireMutation(event);
	const b = await body(
		event,
		z.strictObject({
			shared: z.boolean().default(false),
			label: z.string().min(1).max(100),
			host: z.string().min(1).max(253),
			port: z.number().int().min(1).max(65535),
			secure: z.boolean(),
			username: z.string().min(1).max(320),
			password: z.string().min(1).max(1000),
			fromAddress: z.string().min(3).max(320)
		})
	);
	if (b.shared && u.role !== 'admin') throw new AppError('FORBIDDEN', '공유 발신 프로필은 관리자만 만들 수 있음');
	const { shared, ...input } = b;
	const p = await createSmtpProfile(shared ? null : u.id, input);
	return ok(event, await verifySmtpProfile(p.id, undefined, { actorOwnerId: shared ? null : u.id }), 201);
});
