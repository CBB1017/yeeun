import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** argv-only process execution for local converters (never a shell). */
export function run(
	cmd: string,
	args: string[],
	opts: { timeoutMs: number; cwd?: string; input?: Buffer; env?: NodeJS.ProcessEnv }
): Promise<{ code: number | null; stdout: Buffer; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, {
			cwd: opts.cwd,
			env: opts.env ?? { PATH: process.env.PATH, HOME: opts.cwd ?? tmpdir(), LANG: 'C.UTF-8' },
			stdio: ['pipe', 'pipe', 'pipe'],
			detached: true
		});
		const out: Buffer[] = [];
		let err = '';
		const timer = setTimeout(() => {
			try {
				process.kill(-child.pid!, 'SIGKILL');
			} catch {
				/* already gone */
			}
		}, opts.timeoutMs);
		child.stdout.on('data', (d: Buffer) => out.push(d));
		child.stderr.on('data', (d: Buffer) => {
			if (err.length < 8000) err += d.toString();
		});
		child.on('error', (e) => {
			clearTimeout(timer);
			reject(e);
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve({ code, stdout: Buffer.concat(out), stderr: err });
		});
		if (opts.input) child.stdin.end(opts.input);
		else child.stdin.end();
	});
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(path.join(tmpdir(), 'yeeun-'));
	try {
		return await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

let toolCache: Record<string, boolean> | undefined;
export async function toolAvailable(name: 'soffice' | 'tesseract' | 'pdftoppm'): Promise<boolean> {
	toolCache ??= {};
	if (name in toolCache) return toolCache[name]!;
	try {
		const r = await run(name, name === 'soffice' ? ['--version'] : ['-v'], { timeoutMs: 20000 });
		toolCache[name] = r.code === 0;
	} catch {
		toolCache[name] = false;
	}
	return toolCache[name]!;
}
