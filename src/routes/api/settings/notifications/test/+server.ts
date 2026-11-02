import { handler, ok, requireMutation } from '#lib/server/http.ts';
import { db } from '#lib/server/db/index.ts';
import { enqueueNotifications } from '#lib/server/notify/outbox.ts';
import { config } from '#lib/server/config.ts';

/** Test notification only on the user's explicit button press. */
export const POST = handler(async (event) => {
	const u = requireMutation(event);
	const r = await db().transaction((tx) =>
		enqueueNotifications(
			tx,
			{
				ownerId: u.id,
				runId: null,
				taskId: null,
				event: 'test',
				severity: 'normal',
				title: '테스트 알림',
				body: '알림 설정이 동작하는지 확인하는 테스트입니다.',
				link: `${config().publicOrigin}/settings`
			},
			{ eventKeySuffix: event.locals.requestId }
		)
	);
	return ok(event, r);
});
