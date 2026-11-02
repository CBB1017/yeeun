import { redact } from '../errors';

/**
 * Pure helpers that build what leaves the system in an email or push message.
 * Only title / status / body / an authenticated app link are ever sent: no
 * tokens, no credentials, no host paths, no query strings.
 */

export const NOTIFY_EVENTS = ['completed', 'zero_result', 'error', 'disagreed', 'review_needed', 'test'] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];
export type NotifySeverity = 'normal' | 'error';
export type NotifyChannel = 'email' | 'push';

export const STATUS_LABEL: Record<NotifyEvent, string> = {
	completed: '완료',
	zero_result: '0건',
	error: '오류',
	disagreed: '불일치',
	review_needed: '검토 필요',
	test: '테스트'
};

/** Stored on email rows. */
export interface EmailPayload {
	title: string;
	status: NotifyEvent;
	severity: NotifySeverity;
	body: string;
	link: string;
	/** True when the "오늘은 알림 더 표시 안함" action applies (normal task notification). */
	mutable: boolean;
}

/** Stored on push rows: minimal title/status + authenticated link only (no body). */
export interface PushPayload {
	title: string;
	status: NotifyEvent;
	severity: NotifySeverity;
	link: string;
	mutable: boolean;
}

const TITLE_MAX = 200;
const BODY_MAX = 2000;

const EXTRA_RULES: Array<[RegExp, string]> = [
	// PEM blocks
	[/-----BEGIN [A-Z ]+-----[\s\S]*?(?:-----END [A-Z ]+-----|$)/g, '[redacted-key]'],
	// JWTs
	[/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[redacted-token]'],
	// GitHub / Slack / generic vendor tokens
	[/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,})/g, '[redacted-token]'],
	// key=value secrets in URLs or text
	[
		/\b(token|access_token|refresh_token|id_token|code|key|api_key|apikey|secret|client_secret|signature|sig|password|passwd|pwd|auth)(=)([^&\s"'<>]+)/gi,
		'$1$2[redacted]'
	],
	// "secret: value" style
	[/\b(token|api[_-]?key|secret|client[_-]?secret|password|passwd)(\s*:\s*)([^\s"'<>,;]+)/gi, '$1$2[redacted]'],
	// Windows absolute paths
	[/\b[A-Za-z]:\\[^\s"'<>]*/g, '[path]'],
	// UNC paths
	[/\\\\[A-Za-z0-9._-]+\\[^\s"'<>]*/g, '[path]'],
	// POSIX absolute host/container paths (not URL paths: must not follow ':' or a host char)
	[
		/(^|[\s"'(=,;])\/(?:data|cli-auth|home|root|tmp|var|run|etc|opt|srv|mnt|workspace|app|usr|Users|private|Volumes|proc|secrets)(?:\/[^\s"'<>)]*)?/g,
		'$1[path]'
	],
	// file:// URLs
	[/\bfile:\/\/[^\s"'<>]*/gi, '[path]']
];

/** Redact secrets and host paths from free text that may be sent outside. */
export function sanitizeText(text: string, max: number): string {
	let out = String(text ?? '');
	for (const [re, rep] of EXTRA_RULES) out = out.replace(re, rep);
	out = redact(out);
	// Strip control characters except newline/tab (header injection safety for subjects).
	out = out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
	return out.length > max ? out.slice(0, max - 1) + '…' : out;
}

/**
 * Only same-origin app paths are allowed. Query strings, fragments and
 * credentials are dropped so a link can never carry a token; the target page
 * itself requires an authenticated session.
 */
export function safeLink(link: string, publicOrigin: string): string {
	const base = new URL(publicOrigin);
	const root = `${base.origin}/`;
	let u: URL;
	try {
		u = new URL(String(link ?? ''), root);
	} catch {
		return root;
	}
	if (u.origin !== base.origin || u.username || u.password) return root;
	const path = u.pathname;
	if (!/^\/[A-Za-z0-9/_\-.~%]*$/.test(path) || path.includes('//')) return root;
	return `${base.origin}${path}`;
}

export interface PayloadInput {
	taskId: string | null;
	event: NotifyEvent;
	severity: NotifySeverity;
	title: string;
	body: string;
	link: string;
}

export function buildEmailPayload(e: PayloadInput, publicOrigin: string): EmailPayload {
	return {
		title: sanitizeText(e.title, TITLE_MAX) || STATUS_LABEL[e.event],
		status: e.event,
		severity: e.severity,
		body: sanitizeText(e.body, BODY_MAX),
		link: safeLink(e.link, publicOrigin),
		mutable: e.severity === 'normal' && e.taskId !== null
	};
}

export function toPushPayload(p: EmailPayload): PushPayload {
	return { title: p.title, status: p.status, severity: p.severity, link: p.link, mutable: p.mutable };
}

export function emailMessage(p: EmailPayload): { subject: string; text: string } {
	const label = STATUS_LABEL[p.status] ?? p.status;
	const subject = `[${label}] ${p.title}`.replace(/[\r\n]+/g, ' ').slice(0, 250);
	const lines = [`상태: ${label}`, ''];
	if (p.body) lines.push(p.body, '');
	lines.push(`결과 보기(로그인 필요): ${p.link}`);
	if (p.mutable) lines.push('', `이 작업의 오늘 정상 알림을 끄려면 위 링크에서 "오늘은 알림 더 표시 안함"을 선택하세요.`);
	return { subject, text: lines.join('\n') };
}
