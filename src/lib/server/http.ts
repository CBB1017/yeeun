import { json, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { config } from './config';
import { AppError, isAppError, redact } from './errors';
import { safeEqual } from './crypto';
import type { SessionUser } from './auth/users';

/** API helpers: {data, request_id} envelopes, auth/CSRF/Origin checks, owner scoping. */

export function ok(event: RequestEvent, data: unknown, status = 200) {
	return json({ data, request_id: event.locals.requestId }, { status, headers: { 'cache-control': 'no-store' } });
}

export function fail(event: RequestEvent, e: unknown) {
	const err = isAppError(e) ? e : new AppError('EXECUTION_FAILED', 'internal error');
	if (!isAppError(e)) console.error(`[api] ${event.locals.requestId}`, redact((e as Error)?.stack ?? String(e)));
	return json(
		{ error: { code: err.code, message: err.message, stage: err.stage, retryable: false }, request_id: event.locals.requestId },
		{ status: err.status, headers: { 'cache-control': 'no-store' } }
	);
}

export function requireUser(event: RequestEvent): SessionUser {
	const u = event.locals.user;
	if (!u) throw new AppError('AUTH_REQUIRED', '로그인이 필요합니다');
	return u;
}

export function requireAdmin(event: RequestEvent): SessionUser {
	const u = requireUser(event);
	if (u.role !== 'admin') throw new AppError('NOT_FOUND', 'not found');
	return u;
}

/** Mutations: same-origin + per-session CSRF token header. */
export function requireMutation(event: RequestEvent): SessionUser {
	const u = requireUser(event);
	const origin = event.request.headers.get('origin');
	if (!origin || origin !== config().publicOrigin) throw new AppError('CSRF_FAILED', '요청 출처를 확인할 수 없음');
	const token = event.request.headers.get('x-csrf-token') ?? '';
	if (!safeEqual(token, u.csrfToken)) throw new AppError('CSRF_FAILED', 'CSRF 토큰 불일치');
	return u;
}

export async function body<T extends z.ZodType>(event: RequestEvent, schema: T): Promise<z.infer<T>> {
	let raw: unknown;
	try {
		raw = await event.request.json();
	} catch {
		throw new AppError('VALIDATION_FAILED', 'JSON 본문이 필요합니다');
	}
	const r = schema.safeParse(raw);
	if (!r.success)
		throw new AppError(
			'VALIDATION_FAILED',
			'입력 형식 오류',
			null,
			r.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message }))
		);
	return r.data;
}

export function idempotencyKey(event: RequestEvent): string | null {
	const k = event.request.headers.get('idempotency-key');
	if (!k) return null;
	if (!/^[A-Za-z0-9_-]{8,100}$/.test(k)) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key 형식 오류');
	return k;
}

/** Wraps a handler so every error becomes the standard envelope. */
export function handler(fn: (event: RequestEvent) => Promise<Response>) {
	return async (event: RequestEvent) => {
		try {
			return await fn(event);
		} catch (e) {
			return fail(event, e);
		}
	};
}
