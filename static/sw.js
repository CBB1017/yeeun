/* Web Push service worker: show a notification and open its (same-origin) link on click.
 * Registered only after the user presses "이 기기 등록" in 알림·설정. No caching/offline logic. */

const STATUS_TEXT = {
	completed: '결과가 준비되었습니다',
	zero_result: '조건에 맞는 결과가 0건입니다',
	review_needed: '두 결과가 달라 검토가 필요합니다',
	disagreed: '재검토 후에도 결과가 일치하지 않습니다',
	error: '실행이 오류로 끝났습니다',
	test: '테스트 알림입니다'
};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
	let p = {};
	try {
		p = event.data ? event.data.json() : {};
	} catch {
		p = { title: event.data ? event.data.text() : '' };
	}
	const title = typeof p.title === 'string' && p.title ? p.title : 'Yeeun 알림';
	const body = (STATUS_TEXT[p.status] || '') + (p.mutable ? ' · 링크에서 오늘 이 업무 알림을 끌 수 있습니다' : '');
	let url = '/';
	try {
		const u = new URL(p.link || '/', self.location.origin);
		if (u.origin === self.location.origin) url = u.pathname + u.search + u.hash;
	} catch {
		url = '/';
	}
	event.waitUntil(
		self.registration.showNotification(title, {
			body: body || '내용은 로그인 후 웹에서 확인하세요.',
			icon: '/icon-192.png',
			badge: '/icon-192.png',
			tag: url,
			data: { url },
			requireInteraction: p.severity === 'error'
		})
	);
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = (event.notification.data && event.notification.data.url) || '/';
	event.waitUntil(
		(async () => {
			const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
			for (const c of all) {
				if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
					await c.focus();
					if ('navigate' in c) return c.navigate(url);
					return;
				}
			}
			return self.clients.openWindow(url);
		})()
	);
});
