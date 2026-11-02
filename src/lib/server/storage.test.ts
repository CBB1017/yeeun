import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generatedName, resolveInsideRoot, runRelativeDir, writeFileAtomic } from './storage';

const U = '01900000-0000-7000-8000-000000000001';
const R = '01900000-0000-7000-8000-000000000002';

describe('retained-file paths (A27)', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'yeeun-root-'));

	it('accepts generated relative paths only', async () => {
		const rel = `${runRelativeDir(U, R, 'artifacts')}/${generatedName('xlsx')}`;
		expect(await resolveInsideRoot(root, rel)).toBe(path.join(root, ...rel.split('/')));
	});

	it.each([
		'../etc/passwd',
		'/etc/passwd',
		'users/../../x',
		'users\\..\\x',
		'users/./x',
		'users//x',
		'users/a b/x',
		'users/x\0y'
	])('rejects %s', async (rel) => {
		await expect(resolveInsideRoot(root, rel)).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
	});

	it('rejects symlinks that would escape the root', async () => {
		const outside = mkdtempSync(path.join(tmpdir(), 'yeeun-outside-'));
		writeFileSync(path.join(outside, 'secret.txt'), 'x');
		mkdirSync(path.join(root, 'users'), { recursive: true });
		symlinkSync(outside, path.join(root, 'users', 'link'));
		await expect(resolveInsideRoot(root, 'users/link/secret.txt')).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
	});

	it('never uses user-provided names and refuses non-uuid ids', () => {
		expect(generatedName('csv')).toMatch(/^[0-9a-f-]{36}\.csv$/);
		expect(() => generatedName('../x')).toThrow();
		expect(() => runRelativeDir('../x', R, 'results')).toThrow();
	});

	it('atomic write returns the content hash', async () => {
		const w = await writeFileAtomic({ id: 'r', containerPath: root }, runRelativeDir(U, R, 'results'), generatedName('json'), '{"a":1}');
		expect(w.sha256).toBe('015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862');
		expect(w.sizeBytes).toBe(7);
	});
});
