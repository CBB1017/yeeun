import { config, secret } from '../config';
import { AppError, type ErrorCode } from '../errors';
import type { Provider } from '../../shared/protocol';

/** Worker-side client of the cli-runner service. */

export interface RunnerResult {
	status: 'succeeded' | 'failed' | 'cancelled';
	error_code?: string;
	error_message?: string;
	output?: unknown;
	exit_code: number | null;
	duration_ms: number;
	cli_version?: string;
	model?: string | null;
	usage?: unknown;
	tool_events: number;
}

export interface ProviderStatus {
	installed: boolean;
	version: string | null;
	logged_in: boolean;
	subscription: boolean;
	method: string | null;
	detail: string | null;
}

export interface CliRunner {
	status(fresh?: boolean): Promise<{ forbidden_env: string[]; providers: Record<Provider, ProviderStatus> }>;
	invoke(opts: {
		id: string;
		provider: Provider;
		prompt: string;
		schema: object;
		timeoutSeconds: number;
		signal: AbortSignal;
	}): Promise<RunnerResult>;
}

function headers(): Record<string, string> {
	const token = secret('RUNNER_TOKEN') ?? '';
	return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

const KNOWN: ErrorCode[] = [
	'CLI_UNAVAILABLE',
	'CLI_AUTH_FAILED',
	'USAGE_LIMIT',
	'NETWORK_FAILED',
	'UPSTREAM_5XX',
	'EXECUTION_FAILED',
	'OUTPUT_SCHEMA_INVALID',
	'TIMEOUT',
	'CANCELLED'
];
export function toErrorCode(code: string | undefined): ErrorCode {
	return KNOWN.includes(code as ErrorCode) ? (code as ErrorCode) : 'EXECUTION_FAILED';
}

const sleep = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve) => {
		const t = setTimeout(resolve, ms);
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(t);
				resolve();
			},
			{ once: true }
		);
	});

export const httpRunner: CliRunner = {
	async status(fresh = false) {
		let res: Response;
		try {
			res = await fetch(`${config().cliRunnerUrl}/status${fresh ? '?fresh=1' : ''}`, {
				headers: headers(),
				signal: AbortSignal.timeout(60_000)
			});
		} catch {
			throw new AppError('CLI_UNAVAILABLE', 'cli-runner에 연결할 수 없음');
		}
		if (!res.ok) throw new AppError('CLI_UNAVAILABLE', `cli-runner status ${res.status}`);
		return res.json();
	},
	async invoke({ id, provider, prompt, schema, timeoutSeconds, signal }) {
		const base = config().cliRunnerUrl;
		let start: Response;
		try {
			start = await fetch(`${base}/invocations`, {
				method: 'POST',
				headers: headers(),
				body: JSON.stringify({ id, provider, prompt, schema, timeout_seconds: timeoutSeconds }),
				signal: AbortSignal.timeout(60_000)
			});
		} catch {
			throw new AppError('CLI_UNAVAILABLE', 'cli-runner에 연결할 수 없음', 'executing');
		}
		if (start.status === 409) {
			const j = (await start.json().catch(() => ({}))) as { error_code?: string; error?: string };
			throw new AppError(toErrorCode(j.error_code), j.error ?? `${provider} unavailable`, 'executing');
		}
		if (!start.ok) throw new AppError('EXECUTION_FAILED', `cli-runner start ${start.status}`, 'executing');
		let cancelSent = false;
		for (;;) {
			if (signal.aborted && !cancelSent) {
				cancelSent = true;
				await fetch(`${base}/invocations/${id}`, { method: 'DELETE', headers: headers() }).catch(() => {});
			}
			await sleep(cancelSent ? 500 : 2000, signal.aborted ? undefined : signal);
			let poll: Response;
			try {
				poll = await fetch(`${base}/invocations/${id}`, { headers: headers(), signal: AbortSignal.timeout(30_000) });
			} catch {
				throw new AppError('INTERRUPTED', 'cli-runner 연결이 끊김', 'executing');
			}
			if (poll.status === 404) throw new AppError('INTERRUPTED', 'cli-runner가 재시작되어 실행이 중단됨', 'executing');
			const j = (await poll.json()) as { state: string; result?: RunnerResult };
			if (j.state === 'done' && j.result) {
				await fetch(`${base}/invocations/${id}`, { method: 'DELETE', headers: headers() }).catch(() => {});
				return j.result;
			}
		}
	}
};

let runner: CliRunner = httpRunner;
export function cliRunner(): CliRunner {
	return runner;
}
/** Tests inject a fake runner (clearly mock — never counted as live verification). */
export function setCliRunnerForTests(r: CliRunner | undefined) {
	runner = r ?? httpRunner;
}
