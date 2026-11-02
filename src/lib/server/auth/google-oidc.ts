import * as client from 'openid-client';
import { config } from '../config';
import { AppError } from '../errors';
import { decrypt, encrypt, randomToken } from '../crypto';

/** Google OIDC (login) and separate Drive OAuth (drive.file) flows. */

let discovered: client.Configuration | undefined;

export async function googleClient(): Promise<client.Configuration> {
	if (discovered) return discovered;
	const g = config().google;
	if (!g.clientId || !g.clientSecret) throw new AppError('NOT_CONFIGURED', 'Google OAuth 클라이언트가 설정되지 않음');
	discovered = await client.discovery(new URL('https://accounts.google.com'), g.clientId, g.clientSecret);
	return discovered;
}

export type FlowPurpose = 'login' | 'drive';

export interface PendingFlow {
	purpose: FlowPurpose;
	state: string;
	nonce: string;
	verifier: string;
	exp: number;
	userId?: string;
}

export const FLOW_COOKIE = 'yeeun_oauth';

export function sealFlow(f: PendingFlow): string {
	return encrypt(JSON.stringify(f), 'oauth-flow');
}

export function openFlow(sealed: string | undefined, purpose: FlowPurpose): PendingFlow {
	if (!sealed) throw new AppError('AUTH_REQUIRED', '로그인 요청이 만료됨');
	let f: PendingFlow;
	try {
		f = JSON.parse(decrypt(sealed, 'oauth-flow'));
	} catch {
		throw new AppError('AUTH_REQUIRED', '로그인 요청이 유효하지 않음');
	}
	if (f.purpose !== purpose || f.exp < Date.now()) throw new AppError('AUTH_REQUIRED', '로그인 요청이 만료됨');
	return f;
}

export function redirectUri(purpose: FlowPurpose): string {
	return `${config().publicOrigin}${purpose === 'login' ? '/auth/google/callback' : '/api/drive/callback'}`;
}

export async function startFlow(purpose: FlowPurpose, opts: { userId?: string; loginHint?: string } = {}) {
	const c = await googleClient();
	const verifier = client.randomPKCECodeVerifier();
	const flow: PendingFlow = {
		purpose,
		state: randomToken(24),
		nonce: randomToken(24),
		verifier,
		exp: Date.now() + 10 * 60_000,
		userId: opts.userId
	};
	const params: Record<string, string> = {
		redirect_uri: redirectUri(purpose),
		code_challenge: await client.calculatePKCECodeChallenge(verifier),
		code_challenge_method: 'S256',
		state: flow.state,
		nonce: flow.nonce
	};
	if (purpose === 'login') {
		params.scope = 'openid email profile';
		params.prompt = 'select_account';
	} else {
		// Separate, minimal Drive consent: only files the user explicitly opens with this app.
		// drive.file: write new result copies; drive.readonly: natural-language search/read
		// (user decision 2026-11-02). Users may decline readonly; search then asks to reconnect.
		params.scope = 'openid email https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly';
		params.access_type = 'offline';
		params.prompt = 'consent';
		params.include_granted_scopes = 'false';
		if (opts.loginHint) params.login_hint = opts.loginHint;
	}
	return { url: client.buildAuthorizationUrl(c, params).href, sealed: sealFlow(flow) };
}

export interface FlowResult {
	sub: string;
	email: string;
	emailVerified: boolean;
	name: string | null;
	scopes: string[];
	accessToken: string;
	refreshToken: string | null;
	expiresIn: number;
}

export async function finishFlow(purpose: FlowPurpose, callbackUrl: URL, flow: PendingFlow): Promise<FlowResult> {
	const c = await googleClient();
	// openid-client validates state, nonce, PKCE, issuer, audience and ID token signature/expiry.
	const fixed = new URL(redirectUri(purpose));
	fixed.search = callbackUrl.search;
	let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
	try {
		tokens = await client.authorizationCodeGrant(c, fixed, {
			pkceCodeVerifier: flow.verifier,
			expectedState: flow.state,
			expectedNonce: flow.nonce,
			idTokenExpected: true
		});
	} catch (e) {
		throw new AppError('AUTH_REQUIRED', `Google 인증 확인 실패: ${(e as Error).message.slice(0, 120)}`);
	}
	const claims = tokens.claims();
	if (!claims) throw new AppError('AUTH_REQUIRED', 'ID 토큰 없음');
	if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com')
		throw new AppError('AUTH_REQUIRED', 'issuer 불일치');
	return {
		sub: String(claims.sub),
		email: String(claims.email ?? '').toLowerCase(),
		emailVerified: claims.email_verified === true,
		name: claims.name ? String(claims.name) : null,
		scopes: String(tokens.scope ?? '')
			.split(' ')
			.filter(Boolean),
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token ?? null,
		expiresIn: Number(tokens.expires_in ?? 3600)
	};
}
