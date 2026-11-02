import { error, redirect } from '@sveltejs/kit';

/**
 * Browser API client for the `{data, request_id}` / `{error:{code,message,stage,retryable}}`
 * envelope. Mutations carry the per-session CSRF token header (same-origin fetch
 * also sends the Origin header the server checks).
 */

export class ApiError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string,
		public stage: string | null = null,
		public requestId: string | null = null
	) {
		super(message);
		this.name = 'ApiError';
	}
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
	csrfToken = token;
}

async function ensureCsrf(f: typeof fetch) {
	if (csrfToken) return;
	const me = await api<{ csrfToken: string }>('/api/me', { fetch: f });
	csrfToken = me.csrfToken;
}

export interface ApiOptions {
	method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
	body?: unknown;
	fetch?: typeof fetch;
	idempotencyKey?: string;
	signal?: AbortSignal;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
	const f = opts.fetch ?? fetch;
	const method = opts.method ?? 'GET';
	const headers: Record<string, string> = { accept: 'application/json' };
	// Mutations always carry a JSON body: SvelteKit's built-in form-CSRF guard rejects
	// body-less (no content-type) POST/DELETE when it derives a different self-origin
	// (adapter-node 6 defaults to https without an `origin` option). The app's own
	// Origin + x-csrf-token checks still apply.
	const body = opts.body !== undefined ? opts.body : method !== 'GET' ? {} : undefined;
	if (body !== undefined) headers['content-type'] = 'application/json';
	if (method !== 'GET') {
		await ensureCsrf(f);
		headers['x-csrf-token'] = csrfToken ?? '';
	}
	if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
	let res: Response;
	try {
		res = await f(path, {
			method,
			headers,
			body: body !== undefined ? JSON.stringify(body) : undefined,
			credentials: 'same-origin',
			signal: opts.signal
		});
	} catch (e) {
		if ((e as Error)?.name === 'AbortError') throw e;
		throw new ApiError(0, 'NETWORK_FAILED', '서버에 연결할 수 없습니다. 네트워크 상태를 확인한 뒤 다시 시도하세요.');
	}
	let payload: { data?: T; error?: { code?: string; message?: string; stage?: string | null }; request_id?: string } | null = null;
	try {
		payload = await res.json();
	} catch {
		payload = null;
	}
	if (!res.ok || !payload || payload.error) {
		const e = payload?.error;
		if (e?.code === 'CSRF_FAILED') csrfToken = null;
		throw new ApiError(res.status, e?.code ?? 'EXECUTION_FAILED', e?.message ?? `요청을 처리하지 못했습니다 (HTTP ${res.status})`, e?.stage ?? null, payload?.request_id ?? null);
	}
	return payload.data as T;
}

/** Loader helper: 401 -> login, 404 -> not-found page (never leaks whether another user's id exists). */
export async function load<T>(f: typeof fetch, path: string): Promise<T> {
	try {
		return await api<T>(path, { fetch: f });
	} catch (e) {
		if (e instanceof ApiError) {
			if (e.status === 401) redirect(303, '/login');
			if (e.status === 404) error(404, { message: '찾을 수 없습니다', code: 'NOT_FOUND' });
			error(e.status || 500, { message: e.message, code: e.code });
		}
		throw e;
	}
}

/** Idempotency-Key: 8-100 chars of [A-Za-z0-9_-]. One key per explicit user action. */
export function newIdempotencyKey(prefix = 'ui'): string {
	const raw = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36);
	return `${prefix}-${raw}`.slice(0, 100);
}

export function messageOf(e: unknown): string {
	if (e instanceof ApiError) return e.message;
	if (e instanceof Error) return e.message;
	return String(e);
}
