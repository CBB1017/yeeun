import { z } from 'zod';
import { body, handler, ok, requireMutation } from '#lib/server/http.ts';
import { confirmRecipientChange, startRecipientChange, useLoginEmail } from '#lib/server/notify/settings.ts';

export const POST = handler(async (event) => {
	const u = requireMutation(event);
	const b = await body(
		event,
		z.discriminatedUnion('action', [
			z.strictObject({ action: z.literal('start'), email: z.string().max(320) }),
			z.strictObject({ action: z.literal('confirm'), code: z.string().regex(/^\d{6}$/) }),
			z.strictObject({ action: z.literal('use_login_email') })
		])
	);
	if (b.action === 'start') return ok(event, await startRecipientChange(u.id, b.email));
	if (b.action === 'confirm') return ok(event, await confirmRecipientChange(u.id, b.code));
	return ok(event, await useLoginEmail(u.id));
});
