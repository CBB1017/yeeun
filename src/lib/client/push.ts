import { api } from './api.ts';

/** Browser push: feature detection, permission only on a user gesture, device registration. */

export type PushSupport = 'supported' | 'unsupported' | 'needs_home_screen';

export function pushSupport(ios: boolean, standalone: boolean): PushSupport {
	if (typeof window === 'undefined') return 'unsupported';
	const has = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
	if (has) return 'supported';
	if (ios && !standalone) return 'needs_home_screen';
	return 'unsupported';
}

export function permissionState(): NotificationPermission | 'unsupported' {
	if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
	return Notification.permission;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
	const padding = '='.repeat((4 - (base64.length % 4)) % 4);
	const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(b64);
	const out = new Uint8Array(new ArrayBuffer(raw.length));
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

const LOCAL_KEY = 'yeeun.push.deviceId';

export function localDeviceId(): string | null {
	try {
		return localStorage.getItem(LOCAL_KEY);
	} catch {
		return null;
	}
}

function setLocalDeviceId(id: string | null) {
	try {
		if (id) localStorage.setItem(LOCAL_KEY, id);
		else localStorage.removeItem(LOCAL_KEY);
	} catch {
		/* storage unavailable: registration still works server-side */
	}
}

export function guessDeviceLabel(): string {
	const ua = navigator.userAgent;
	const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '기기';
	const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '브라우저';
	return `${os} · ${br}`;
}

/** Must be called from a click handler (user gesture). Returns the server device id. */
export async function registerThisDevice(vapidPublicKey: string): Promise<{ id: string; permission: NotificationPermission }> {
	const permission = await Notification.requestPermission();
	if (permission !== 'granted') return { id: '', permission };
	const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
	await navigator.serviceWorker.ready;
	let sub = await reg.pushManager.getSubscription();
	if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) });
	const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
	const r = await api<{ id: string }>('/api/settings/push-subscriptions', {
		method: 'POST',
		body: { subscription: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }, deviceLabel: guessDeviceLabel() }
	});
	setLocalDeviceId(r.id);
	return { id: r.id, permission };
}

export async function unregisterDevice(id: string) {
	await api('/api/settings/push-subscriptions', { method: 'DELETE', body: { id } });
	if (localDeviceId() === id) {
		setLocalDeviceId(null);
		try {
			const reg = await navigator.serviceWorker?.getRegistration('/');
			const sub = await reg?.pushManager.getSubscription();
			await sub?.unsubscribe();
		} catch {
			/* local unsubscribe is best effort; the server row is already revoked */
		}
	}
}
