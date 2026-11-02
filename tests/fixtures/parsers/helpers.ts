import { expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { AppError, type ErrorCode } from '../../../src/lib/server/errors';
import { parseSource } from '../../../src/lib/server/parsers';
import type { ParseInput, ParseOutput } from '../../../src/lib/server/parsers/types';
import { TableSchema, TextBlockSchema, type Cell, type Table } from '../../../src/lib/shared/manifest';
import { defaultSelector, type SourceSelector } from '../../../src/lib/shared/plan';

export function input(
	bytes: Buffer,
	name: string,
	opts: { mimeType?: string; selector?: Partial<SourceSelector>; maxOcrPages?: number; used?: number; fileIndex?: number } = {}
): ParseInput {
	return {
		bytes,
		name,
		mimeType: opts.mimeType ?? 'application/octet-stream',
		fileIndex: opts.fileIndex ?? 0,
		selector: { ...defaultSelector(), ...opts.selector },
		maxOcrPages: opts.maxOcrPages ?? 50,
		ocrBudget: { used: opts.used ?? 0 }
	};
}

/** Parse and run the invariants every manifest must satisfy. */
export async function parse(i: ParseInput): Promise<ParseOutput> {
	const out = await parseSource(i);
	assertManifestInvariants(out);
	return out;
}

/** Every evidence id (rows, cells, text blocks) must be unique and the output must satisfy the manifest schema. */
export function assertManifestInvariants(out: ParseOutput): void {
	z.array(TableSchema).parse(out.tables);
	z.array(TextBlockSchema).parse(out.texts);
	assertUniqueEvidenceIds(out);
}

export function assertUniqueEvidenceIds(out: ParseOutput): void {
	const ids: string[] = [];
	for (const t of out.tables) {
		for (const r of t.rows) {
			ids.push(r.evidence_id);
			for (const c of r.cells) ids.push(c.evidence_id);
		}
	}
	for (const b of out.texts) ids.push(b.evidence_id);
	const seen = new Set<string>();
	const dups = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
	expect(dups, 'duplicate evidence ids').toEqual([]);
	const tableIds = out.tables.map((t) => t.table_id);
	expect(new Set(tableIds).size, 'duplicate table ids').toBe(tableIds.length);
}

export async function expectAppError(p: Promise<unknown>, code: ErrorCode): Promise<AppError> {
	let caught: unknown;
	try {
		const v = await p;
		caught = new Error(`expected AppError ${code} but parse succeeded: ${JSON.stringify(v).slice(0, 300)}`);
	} catch (e) {
		caught = e;
	}
	expect(caught).toBeInstanceOf(AppError);
	expect((caught as AppError).code, (caught as Error).message).toBe(code);
	return caught as AppError;
}

export function cellAt(t: Table, ref: string): Cell {
	const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
	const row = t.rows.find((r) => r.row_number === Number(m[2]));
	if (!row) throw new Error(`row ${m[2]} not in table ${t.table_id}`);
	const c = row.cells.find((x) => x.column_id === m[1]);
	if (!c) throw new Error(`column ${m[1]} not in table ${t.table_id}`);
	return c;
}

export async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(path.join(tmpdir(), 'yeeun-fx-'));
	try {
		return await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

export function allText(out: ParseOutput): string {
	return out.texts.map((t) => t.text).join('\n');
}
