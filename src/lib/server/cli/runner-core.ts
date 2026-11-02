import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Core of the cli-runner service. Only these fixed argv templates are ever
 * executed; prompt text is passed on stdin as data. No built-in tools, MCP
 * servers, plugins, hooks or session persistence are enabled.
 */

export type Provider = 'claude' | 'codex';

export const FORBIDDEN_ENV = [
	'ANTHROPIC_API_KEY',
	'ANTHROPIC_AUTH_TOKEN',
	'ANTHROPIC_BASE_URL',
	'CLAUDE_CODE_USE_BEDROCK',
	'CLAUDE_CODE_USE_VERTEX',
	'CLAUDE_CODE_USE_FOUNDRY',
	'OPENAI_API_KEY',
	'OPENAI_BASE_URL',
	'CODEX_API_KEY',
	'AZURE_OPENAI_API_KEY'
];

export const CODEX_DISABLED_FEATURES = [
	'shell_tool',
	'unified_exec',
	'apps',
	'plugins',
	'browser_use',
	'browser_use_external',
	'in_app_browser',
	'computer_use',
	'image_generation',
	'multi_agent',
	'hooks',
	'view_image',
	'skill_search',
	'tool_suggest',
	'sleep_tool',
	'goals',
	'remote_plugin',
	'workspace_dependencies',
	'skill_mcp_dependency_install',
	'daemon_auto_start',
	'in_app_local_automation',
	'code_mode_host'
];

export function childEnv(): NodeJS.ProcessEnv {
	const keep = [
		'PATH',
		'HOME',
		'LANG',
		'TZ',
		'CLAUDE_CONFIG_DIR',
		'CODEX_HOME',
		'DISABLE_AUTOUPDATER',
		'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
		'NODE_EXTRA_CA_CERTS'
	];
	const env: NodeJS.ProcessEnv = { LANG: 'C.UTF-8', DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' };
	for (const k of keep) if (process.env[k]) env[k] = process.env[k];
	return env;
}

export function claudeArgs(schema: object): string[] {
	return [
		'-p',
		'--output-format',
		'json',
		'--json-schema',
		JSON.stringify(schema),
		'--tools',
		'',
		'--strict-mcp-config',
		'--mcp-config',
		'{"mcpServers":{}}',
		'--safe-mode',
		'--disable-slash-commands',
		'--no-session-persistence',
		'--no-chrome',
		'--permission-mode',
		'dontAsk',
		'--permission-prompts',
		'none'
	];
}

export function codexArgs(schemaFile: string, outFile: string, workdir: string): string[] {
	const args = [
		'exec',
		'--skip-git-repo-check',
		'--ephemeral',
		'--ignore-user-config',
		'--ignore-rules',
		'--sandbox',
		'read-only',
		'--color',
		'never',
		'--json',
		'--output-schema',
		schemaFile,
		'-o',
		outFile,
		'-C',
		workdir,
		'-c',
		'approval_policy="never"',
		'-c',
		'web_search="disabled"',
		'-c',
		'mcp_servers={}'
	];
	for (const f of CODEX_DISABLED_FEATURES) args.push('--disable', f);
	args.push('-');
	return args;
}

const NON_TOOL_ITEMS = ['agent_message', 'reasoning', 'error', 'todo_list'];

export interface InvocationResult {
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

export function classifyError(text: string): string {
	const t = text.toLowerCase();
	if (/usage limit|rate limit|quota|429|too many requests|limit reached|exceeded your/.test(t)) return 'USAGE_LIMIT';
	if (/not logged in|unauthori[sz]ed|401|invalid.*token|authentication|please log ?in|login required|expired/.test(t))
		return 'CLI_AUTH_FAILED';
	if (/\b5\d\d\b|overloaded|internal server error|bad gateway|service unavailable/.test(t)) return 'UPSTREAM_5XX';
	if (/econn|enotfound|etimedout|network|socket hang up|fetch failed|getaddrinfo/.test(t)) return 'NETWORK_FAILED';
	return 'EXECUTION_FAILED';
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals) {
	if (!child.pid) return;
	try {
		process.kill(-child.pid, signal);
	} catch {
		/* gone */
	}
}

export interface Invocation {
	id: string;
	provider: Provider;
	child?: ChildProcess;
	promise: Promise<InvocationResult>;
	result?: InvocationResult;
	cancel: () => void;
	createdAt: number;
}

export function startInvocation(opts: {
	id: string;
	provider: Provider;
	prompt: string;
	schema: object;
	timeoutSeconds: number;
	workRoot: string;
	cliVersion?: string;
}): Invocation {
	const started = Date.now();
	let child: ChildProcess | undefined;
	let cancelled = false;
	let timedOut = false;
	const inv: Partial<Invocation> = { id: opts.id, provider: opts.provider, createdAt: started };
	inv.cancel = () => {
		cancelled = true;
		if (child) {
			killGroup(child, 'SIGTERM');
			setTimeout(() => child && killGroup(child, 'SIGKILL'), 10_000).unref();
		}
	};
	inv.promise = (async (): Promise<InvocationResult> => {
		await mkdir(opts.workRoot, { recursive: true });
		const dir = await mkdtemp(path.join(opts.workRoot, `${opts.provider}-`));
		try {
			let cmd: string;
			let args: string[];
			const outFile = path.join(dir, '.out', 'last.json');
			if (opts.provider === 'claude') {
				cmd = 'claude';
				args = claudeArgs(opts.schema);
			} else {
				await mkdir(path.join(dir, '.out'));
				const schemaFile = path.join(dir, '.out', 'schema.json');
				await writeFile(schemaFile, JSON.stringify(opts.schema));
				cmd = 'codex';
				args = codexArgs(schemaFile, outFile, dir);
			}
			const res = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
				child = spawn(cmd, args, {
					cwd: dir,
					env: { ...childEnv(), HOME: process.env.HOME },
					stdio: ['pipe', 'pipe', 'pipe'],
					detached: true
				});
				inv.child = child;
				let stdout = '';
				let stderr = '';
				child.stdout!.on('data', (d: Buffer) => {
					if (stdout.length < 20_000_000) stdout += d.toString('utf8');
				});
				child.stderr!.on('data', (d: Buffer) => {
					if (stderr.length < 200_000) stderr += d.toString('utf8');
				});
				const timer = setTimeout(() => {
					timedOut = true;
					inv.cancel!();
				}, opts.timeoutSeconds * 1000);
				child.on('error', (e) => {
					clearTimeout(timer);
					reject(e);
				});
				child.on('close', (code) => {
					clearTimeout(timer);
					resolve({ code, stdout, stderr });
				});
				child.stdin!.end(opts.prompt, 'utf8');
			});
			const base = { exit_code: res.code, duration_ms: Date.now() - started, cli_version: opts.cliVersion };
			if (timedOut) return { ...base, status: 'failed', error_code: 'TIMEOUT', error_message: 'CLI stage timeout', tool_events: 0 };
			if (cancelled) return { ...base, status: 'cancelled', error_code: 'CANCELLED', tool_events: 0 };
			return opts.provider === 'claude' ? parseClaude(res, base) : await parseCodex(res, base, outFile);
		} catch (e) {
			return {
				status: 'failed',
				error_code: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'CLI_UNAVAILABLE' : 'EXECUTION_FAILED',
				error_message: (e as Error).message.slice(0, 300),
				exit_code: null,
				duration_ms: Date.now() - started,
				tool_events: 0
			};
		} finally {
			// CLI temporary session/work data is removed with the per-invocation directory.
			await rm(dir, { recursive: true, force: true });
		}
	})();
	return inv as Invocation;
}

type Base = { exit_code: number | null; duration_ms: number; cli_version?: string };

function parseClaude(res: { code: number | null; stdout: string; stderr: string }, base: Base): InvocationResult {
	let j: Record<string, any>;
	try {
		j = JSON.parse(res.stdout.trim());
	} catch {
		const text = `${res.stderr}\n${res.stdout}`;
		return {
			...base,
			status: 'failed',
			error_code: res.code === 0 ? 'OUTPUT_SCHEMA_INVALID' : classifyError(text),
			error_message: text.slice(0, 300),
			tool_events: 0
		};
	}
	const model = j.modelUsage ? (Object.keys(j.modelUsage)[0] ?? null) : null;
	const usage = { input_tokens: j.usage?.input_tokens, output_tokens: j.usage?.output_tokens, num_turns: j.num_turns };
	if (j.is_error || j.subtype !== 'success' || res.code !== 0) {
		const text = String(j.result ?? j.subtype ?? res.stderr);
		return { ...base, status: 'failed', error_code: classifyError(text), error_message: text.slice(0, 300), model, usage, tool_events: 0 };
	}
	let output = j.structured_output;
	if (output === undefined && typeof j.result === 'string') {
		try {
			output = JSON.parse(j.result);
		} catch {
			return {
				...base,
				status: 'failed',
				error_code: 'OUTPUT_SCHEMA_INVALID',
				error_message: 'result is not JSON',
				model,
				usage,
				tool_events: 0
			};
		}
	}
	const toolEvents = Array.isArray(j.permission_denials) ? j.permission_denials.length : 0;
	return { ...base, status: 'succeeded', output, model, usage, tool_events: toolEvents };
}

async function parseCodex(
	res: { code: number | null; stdout: string; stderr: string },
	base: Base,
	outFile: string
): Promise<InvocationResult> {
	let model: string | null = null;
	let usage: unknown;
	const toolItemIds = new Set<string>();
	let errorText = '';
	for (const line of res.stdout.split('\n')) {
		if (!line.trim()) continue;
		try {
			const ev = JSON.parse(line) as Record<string, any>;
			const t = String(ev.type ?? '');
			if (t === 'turn.completed') usage = ev.usage;
			if (t === 'thread.started' && ev.model) model = ev.model;
			// Count only real model actions; 'error' items are CLI notices (e.g. a disabled feature failing closed).
			if (t.startsWith('item.') && ev.item && !NON_TOOL_ITEMS.includes(String(ev.item.type ?? ev.item.item_type)))
				toolItemIds.add(String(ev.item.id ?? `${toolItemIds.size}`));
			if (t === 'error' || t === 'turn.failed') errorText += ` ${JSON.stringify(ev.error ?? ev.message ?? ev)}`;
		} catch {
			/* non-JSON line */
		}
	}
	const toolEvents = toolItemIds.size;
	if (res.code !== 0 || errorText) {
		const text = `${errorText} ${res.stderr}`.trim();
		return {
			...base,
			status: 'failed',
			error_code: classifyError(text),
			error_message: text.slice(0, 300),
			model,
			usage,
			tool_events: toolEvents
		};
	}
	let raw: string;
	try {
		raw = await readFile(outFile, 'utf8');
	} catch {
		return {
			...base,
			status: 'failed',
			error_code: 'OUTPUT_SCHEMA_INVALID',
			error_message: 'no final message',
			model,
			usage,
			tool_events: toolEvents
		};
	}
	try {
		return { ...base, status: 'succeeded', output: JSON.parse(raw), model, usage, tool_events: toolEvents };
	} catch {
		return {
			...base,
			status: 'failed',
			error_code: 'OUTPUT_SCHEMA_INVALID',
			error_message: 'final message is not JSON',
			model,
			usage,
			tool_events: toolEvents
		};
	}
}

export interface ProviderStatus {
	installed: boolean;
	version: string | null;
	logged_in: boolean;
	subscription: boolean;
	method: string | null;
	detail: string | null;
}

export function execText(cmd: string, args: string[], timeoutMs = 20_000): Promise<{ code: number | null; out: string }> {
	return new Promise((resolve) => {
		let out = '';
		let child: ChildProcess;
		try {
			child = spawn(cmd, args, { env: { ...childEnv(), HOME: process.env.HOME }, stdio: ['ignore', 'pipe', 'pipe'] });
		} catch {
			return resolve({ code: null, out: '' });
		}
		const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
		child.stdout!.on('data', (d: Buffer) => (out += d.toString()));
		child.stderr!.on('data', (d: Buffer) => (out += d.toString()));
		child.on('error', () => {
			clearTimeout(t);
			resolve({ code: null, out: '' });
		});
		child.on('close', (code) => {
			clearTimeout(t);
			resolve({ code, out });
		});
	});
}

export async function providerStatus(provider: Provider): Promise<ProviderStatus> {
	const v = await execText(provider, ['--version']);
	if (v.code !== 0)
		return { installed: false, version: null, logged_in: false, subscription: false, method: null, detail: 'CLI not installed' };
	const version = v.out.trim().split('\n')[0] ?? null;
	if (provider === 'claude') {
		const s = await execText('claude', ['auth', 'status', '--json']);
		try {
			const j = JSON.parse(s.out.slice(s.out.indexOf('{')));
			const method = String(j.authMethod ?? 'none');
			const subscription = Boolean(j.loggedIn) && !/api[_ ]?key|console/i.test(method) && method !== 'none';
			return {
				installed: true,
				version,
				logged_in: Boolean(j.loggedIn),
				subscription,
				method,
				detail: j.subscriptionType ? String(j.subscriptionType) : null
			};
		} catch {
			return { installed: true, version, logged_in: false, subscription: false, method: null, detail: 'status unreadable' };
		}
	}
	const s = await execText('codex', ['login', 'status']);
	const text = s.out.trim();
	const loggedIn = s.code === 0 && /logged in/i.test(text);
	const subscription = loggedIn && /chatgpt/i.test(text) && !/api key/i.test(text);
	return {
		installed: true,
		version,
		logged_in: loggedIn,
		subscription,
		method: loggedIn ? (subscription ? 'chatgpt' : 'api_key') : null,
		detail: text.split('\n')[0]?.slice(0, 120) ?? null
	};
}
