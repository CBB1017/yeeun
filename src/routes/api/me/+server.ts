import { handler, ok, requireUser } from '#lib/server/http.ts';
import { googleConfigured, pickerConfigured, config } from '#lib/server/config.ts';
import { connectionStatus } from '#lib/server/drive/service.ts';
import { capabilitySummary } from '#lib/server/capabilities.ts';

export const GET = handler(async (event) => {
	const u = requireUser(event);
	return ok(event, {
		user: { id: u.id, email: u.email, name: u.name, role: u.role, timezone: u.timezone },
		csrfToken: u.csrfToken,
		features: {
			google: googleConfigured(),
			picker: pickerConfigured(),
			push: Boolean(config().vapid.publicKey && config().vapid.privateKey),
			vapidPublicKey: config().vapid.publicKey ?? null
		},
		drive: await connectionStatus(u.id),
		capabilities: await capabilitySummary(u.role === 'admin')
	});
});
