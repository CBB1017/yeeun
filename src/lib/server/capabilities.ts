import { eq } from 'drizzle-orm';
import { db, schema } from './db';
import { googleConfigured, pickerConfigured, config } from './config';

/**
 * Capability health as last observed by the worker (the web container cannot
 * reach the cli-runner). Non-admin users only see whether execution is
 * available — never tokens, account details or paths.
 */
export async function capabilitySummary(admin: boolean) {
	const [row] = await db().select().from(schema.appSettings).where(eq(schema.appSettings.key, 'capability_status')).limit(1);
	const v = (row?.value ?? {}) as {
		checked_at?: string;
		runner?: string;
		forbidden_env?: string[];
		providers?: Record<
			string,
			{ installed: boolean; logged_in: boolean; subscription: boolean; version: string | null; method: string | null }
		>;
		storage_writable?: boolean;
	};
	const p = v.providers ?? {};
	const ready = (k: string) => Boolean(p[k]?.installed && p[k]?.logged_in && p[k]?.subscription) && !v.forbidden_env?.length;
	const execution = v.runner === 'reachable' && ready('claude') && ready('codex');
	const base = {
		checked_at: v.checked_at ?? null,
		execution_available: execution,
		message: execution ? null : '소유자 CLI 실행 환경이 준비되지 않아 새 실행은 대기하거나 오류로 끝납니다. 관리자에게 문의하세요.'
	};
	if (!admin) return base;
	return {
		...base,
		runner: v.runner ?? 'unknown',
		forbidden_env: v.forbidden_env ?? [],
		claude: p.claude
			? {
					installed: p.claude.installed,
					logged_in: p.claude.logged_in,
					subscription: p.claude.subscription,
					version: p.claude.version,
					method: p.claude.method
				}
			: null,
		codex: p.codex
			? {
					installed: p.codex.installed,
					logged_in: p.codex.logged_in,
					subscription: p.codex.subscription,
					version: p.codex.version,
					method: p.codex.method
				}
			: null,
		storage_writable: v.storage_writable ?? null,
		google_oauth: googleConfigured(),
		google_picker: pickerConfigured(),
		smtp_default: Boolean(config().smtpDefault.host && config().smtpDefault.from),
		web_push: Boolean(config().vapid.publicKey && config().vapid.privateKey)
	};
}
