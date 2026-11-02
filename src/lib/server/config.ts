import { readFileSync, existsSync } from 'node:fs';

/**
 * Runtime configuration shared by web, worker and migrate.
 * Secrets are read from files (Docker secrets) and never logged.
 */

function env(name: string, fallback?: string): string | undefined {
	const v = process.env[name];
	return v === undefined || v === '' ? fallback : v;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
	const raw = env(name);
	if (raw === undefined) return fallback;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < min || n > max) {
		throw new Error(`${name} must be an integer in [${min}, ${max}]`);
	}
	return n;
}

export function readSecretFile(path: string | undefined): string | undefined {
	if (!path || !existsSync(path)) return undefined;
	return readFileSync(path, 'utf8').trim();
}

/** Reads `NAME` or the file at `NAME_FILE`. */
export function secret(name: string): string | undefined {
	return env(name) ?? readSecretFile(env(`${name}_FILE`));
}

export function databaseUrl(): string {
	const url = env('DATABASE_URL');
	if (url) return url;
	const password = secret('POSTGRES_PASSWORD');
	if (!password) throw new Error('DATABASE_URL or POSTGRES_PASSWORD_FILE is required');
	const host = env('POSTGRES_HOST', 'db');
	const user = env('POSTGRES_USER', 'yeeun');
	const db = env('POSTGRES_DB', 'yeeun');
	return `postgres://${encodeURIComponent(user!)}:${encodeURIComponent(password)}@${host}:5432/${db}`;
}

export interface AppConfig {
	publicOrigin: string;
	bootstrapAdminEmail?: string;
	operator: { name: string; contactEmail: string | null };
	google: {
		clientId?: string;
		clientSecret?: string;
		pickerApiKey?: string;
		pickerAppId?: string;
	};
	fileStorageRoot: string;
	fileStorageHostLabel: string;
	taskConcurrency: number;
	cliStageTimeoutSeconds: number;
	taskTimeoutSeconds: number;
	heartbeatSeconds: number;
	leaseSeconds: number;
	maxSourceFileBytes: number;
	maxRunSourceBytes: number;
	maxOcrPages: number;
	cliRunnerUrl: string;
	vapid: { publicKey?: string; privateKey?: string; subject?: string };
	smtpDefault: {
		host?: string;
		port?: number;
		secure: boolean;
		user?: string;
		password?: string;
		from?: string;
	};
}

let cached: AppConfig | undefined;

export function config(): AppConfig {
	if (cached) return cached;
	const stage = intEnv('CLI_STAGE_TIMEOUT_SECONDS', 1800, 60, 7200);
	const task = intEnv('TASK_TIMEOUT_SECONDS', 5400, 60, 6 * 3600);
	if (task < stage) throw new Error('TASK_TIMEOUT_SECONDS must be >= CLI_STAGE_TIMEOUT_SECONDS');
	const heartbeat = intEnv('WORKER_HEARTBEAT_SECONDS', 15, 1, 300);
	const lease = intEnv('WORKER_LEASE_SECONDS', 60, 5, 3600);
	if (lease <= heartbeat) throw new Error('WORKER_LEASE_SECONDS must exceed WORKER_HEARTBEAT_SECONDS');
	const smtpPort = env('SMTP_PORT');
	cached = {
		publicOrigin: env('PUBLIC_ORIGIN', 'http://localhost:3000')!.replace(/\/$/, ''),
		bootstrapAdminEmail: env('BOOTSTRAP_ADMIN_EMAIL')?.trim().toLowerCase(),
		operator: { name: env('OPERATOR_NAME', 'Yeeun 운영자')!, contactEmail: env('OPERATOR_CONTACT_EMAIL') ?? null },
		google: {
			clientId: env('GOOGLE_CLIENT_ID'),
			clientSecret: secret('GOOGLE_CLIENT_SECRET'),
			pickerApiKey: secret('GOOGLE_PICKER_API_KEY'),
			pickerAppId: env('GOOGLE_PICKER_APP_ID')
		},
		fileStorageRoot: env('FILE_STORAGE_ROOT', '/data')!,
		fileStorageHostLabel: env('FILE_STORAGE_HOST_LABEL', './file')!,
		taskConcurrency: intEnv('TASK_CONCURRENCY', 1, 1, 8),
		cliStageTimeoutSeconds: stage,
		taskTimeoutSeconds: task,
		heartbeatSeconds: heartbeat,
		leaseSeconds: lease,
		maxSourceFileBytes: intEnv('MAX_SOURCE_FILE_BYTES', 100 * 1024 * 1024, 1024, 2 ** 31),
		maxRunSourceBytes: intEnv('MAX_RUN_SOURCE_BYTES', 500 * 1024 * 1024, 1024, 2 ** 33),
		maxOcrPages: intEnv('MAX_OCR_PAGES', 300, 1, 5000),
		cliRunnerUrl: env('CLI_RUNNER_URL', 'http://cli-runner:4100')!,
		vapid: {
			publicKey: env('VAPID_PUBLIC_KEY'),
			privateKey: secret('VAPID_PRIVATE_KEY'),
			subject: env('VAPID_SUBJECT')
		},
		smtpDefault: {
			host: env('SMTP_HOST'),
			port: smtpPort ? Number(smtpPort) : undefined,
			secure: env('SMTP_SECURE', 'true') === 'true',
			user: env('SMTP_USER'),
			password: secret('SMTP_PASSWORD'),
			from: env('SMTP_FROM')
		}
	};
	return cached;
}

/** For tests only. */
export function resetConfigForTests(): void {
	cached = undefined;
}

export function googleConfigured(): boolean {
	const g = config().google;
	return Boolean(g.clientId && g.clientSecret);
}

export function pickerConfigured(): boolean {
	const g = config().google;
	return Boolean(googleConfigured() && g.pickerApiKey && g.pickerAppId);
}
