import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import {
	FORBIDDEN_ENV,
	providerStatus,
	startInvocation,
	type Invocation,
	type Provider,
	type ProviderStatus
} from '../lib/server/cli/runner-core';

/**
 * cli-runner: holds only the CLI binaries and the owner's subscription auth
 * volume. No user files, no database credentials, no Docker socket. The worker
 * submits {provider, prompt, schema}; argv is fixed in runner-core.
 */

const PORT = Number(process.env.RUNNER_PORT ?? 4100);
const WORK_ROOT = process.env.RUNNER_WORK_ROOT ?? '/runner/work';
const tokenFile = process.env.RUNNER_TOKEN_FILE ?? '/run/secrets/runner_token';
const TOKEN = existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : '';
const MAX_BODY = 40 * 1024 * 1024;

const forbidden = FORBIDDEN_ENV.filter((k) => process.env[k]);
const invocations = new Map<string, Invocation>();
let statusCache: { at: number; value: Record<Provider, ProviderStatus> } | undefined;

async function statuses(force = false): Promise<Record<Provider, ProviderStatus>> {
	if (!force && statusCache && Date.now() - statusCache.at < 30_000) return statusCache.value;
	const [claude, codex] = await Promise.all([providerStatus('claude'), providerStatus('codex')]);
	statusCache = { at: Date.now(), value: { claude, codex } };
	return statusCache.value;
}

function authorized(req: http.IncomingMessage): boolean {
	const h = req.headers['authorization'] ?? '';
	const given = Buffer.from(String(h).replace(/^Bearer\s+/i, ''));
	const want = Buffer.from(TOKEN);
	return TOKEN.length >= 32 && given.length === want.length && timingSafeEqual(given, want);
}

function send(res: http.ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
	res.end(JSON.stringify(body));
}

async function body(req: http.IncomingMessage): Promise<any> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const c of req) {
		size += (c as Buffer).length;
		if (size > MAX_BODY) throw new Error('body too large');
		chunks.push(c as Buffer);
	}
	return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const ID_RE = /^[A-Za-z0-9:_-]{8,200}$/;

const server = http.createServer(async (req, res) => {
	try {
		const url = new URL(req.url ?? '/', 'http://runner');
		if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
		if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });

		if (req.method === 'GET' && url.pathname === '/status') {
			return send(res, 200, { forbidden_env: forbidden, providers: await statuses(url.searchParams.has('fresh')) });
		}

		const m = /^\/invocations\/([^/]+)$/.exec(url.pathname);
		if (req.method === 'POST' && url.pathname === '/invocations') {
			const b = await body(req);
			if (
				!ID_RE.test(String(b.id)) ||
				!['claude', 'codex'].includes(b.provider) ||
				typeof b.prompt !== 'string' ||
				typeof b.schema !== 'object'
			) {
				return send(res, 400, { error: 'bad request' });
			}
			const existing = invocations.get(b.id);
			if (existing) return send(res, 200, { id: b.id, state: existing.result ? 'done' : 'running', duplicate: true });
			if (forbidden.length)
				return send(res, 409, { error_code: 'CLI_AUTH_FAILED', error: `API billing variables present: ${forbidden.join(',')}` });
			const st = (await statuses())[b.provider as Provider];
			if (!st.installed) return send(res, 409, { error_code: 'CLI_UNAVAILABLE', error: `${b.provider} not installed` });
			if (!st.logged_in || !st.subscription) {
				return send(res, 409, { error_code: 'CLI_AUTH_FAILED', error: `${b.provider} subscription login required` });
			}
			const timeout = Math.min(Math.max(Number(b.timeout_seconds) || 1800, 30), 7200);
			const inv = startInvocation({
				id: b.id,
				provider: b.provider,
				prompt: b.prompt,
				schema: b.schema,
				timeoutSeconds: timeout,
				workRoot: WORK_ROOT,
				cliVersion: st.version ?? undefined
			});
			invocations.set(b.id, inv);
			inv.promise.then((r) => {
				inv.result = r;
				if (r.error_code === 'CLI_AUTH_FAILED') statusCache = undefined;
			});
			return send(res, 202, { id: b.id, state: 'running' });
		}
		if (m && req.method === 'GET') {
			const inv = invocations.get(m[1]!);
			if (!inv) return send(res, 404, { error: 'unknown invocation' });
			if (!inv.result) return send(res, 200, { id: inv.id, state: 'running' });
			return send(res, 200, { id: inv.id, state: 'done', result: inv.result });
		}
		if (m && req.method === 'DELETE') {
			const inv = invocations.get(m[1]!);
			if (!inv) return send(res, 404, { error: 'unknown invocation' });
			if (!inv.result) inv.cancel();
			else invocations.delete(inv.id);
			return send(res, 200, { id: inv.id, state: inv.result ? 'removed' : 'cancelling' });
		}
		return send(res, 404, { error: 'not found' });
	} catch (e) {
		return send(res, 400, { error: (e as Error).message.slice(0, 200) });
	}
});

// Drop finished invocation records after an hour.
setInterval(() => {
	const cutoff = Date.now() - 3600_000;
	for (const [id, inv] of invocations) if (inv.result && inv.createdAt < cutoff) invocations.delete(id);
}, 60_000).unref();

server.requestTimeout = 120_000;
server.listen(PORT, '0.0.0.0', () => {
	console.log(
		`[cli-runner] listening on ${PORT}${forbidden.length ? ' (API billing env present: invocations blocked)' : ''}${TOKEN ? '' : ' (no runner token: all requests rejected)'}`
	);
});

function shutdown() {
	console.log('[cli-runner] shutting down; cancelling running invocations');
	for (const inv of invocations.values()) if (!inv.result) inv.cancel();
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 12_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
