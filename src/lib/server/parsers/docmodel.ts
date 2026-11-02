import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { Table, TextBlock } from '../../shared/manifest';
import { colLetter, typedFromText, type ParseOutput } from './types';
import { ocrImage } from './ocr';

/**
 * Shared model for word-processor documents (docx/doc/hwpx/hwp): body
 * paragraphs and tables in document order, side parts (headers, footers,
 * footnotes, text boxes) and embedded images. Evidence ids:
 *   f{fi}.d.p{n}            body paragraph n (1-based, counts empty paragraphs too)
 *   f{fi}.d.t{k}!{col}{row} table k cell (row 1 = header)
 *   f{fi}.d.{part}{n}       header/footer/footnote/endnote/text box/caption block
 */

type Loc = Record<string, string | number | boolean | null>;

/** Order-preserving XML parser (mixed content, run order, sibling order). */
export const orderedXml = new XMLParser({
	ignoreAttributes: false,
	removeNSPrefix: true,
	attributeNamePrefix: '@',
	parseTagValue: false,
	parseAttributeValue: false,
	trimValues: false,
	preserveOrder: true,
	htmlEntities: true
});

export type XNode = Record<string, unknown>;

export function tagOf(n: XNode): string {
	for (const k of Object.keys(n)) if (k !== ':@') return k;
	return '';
}

export function kids(n: XNode | undefined): XNode[] {
	if (!n) return [];
	const v = n[tagOf(n)];
	return Array.isArray(v) ? (v as XNode[]) : [];
}

export function attr(n: XNode | undefined, name: string): string | undefined {
	const a = n?.[':@'] as Record<string, unknown> | undefined;
	const v = a?.[`@${name}`];
	return v === undefined || v === null ? undefined : String(v);
}

export function child(n: XNode | undefined, tag: string): XNode | undefined {
	return kids(n).find((c) => tagOf(c) === tag);
}

export function children(n: XNode | undefined, tag: string): XNode[] {
	return kids(n).filter((c) => tagOf(c) === tag);
}

/** Depth-first search for elements with this tag (not descending into matches). */
export function findAllX(nodes: XNode[], tag: string, out: XNode[] = []): XNode[] {
	for (const n of nodes) {
		if (tagOf(n) === tag) out.push(n);
		else findAllX(kids(n), tag, out);
	}
	return out;
}

/** Concatenated '#text' of a leaf element (e.g. w:t). */
export function textOf(n: XNode): string {
	return kids(n)
		.map((c) => (tagOf(c) === '#text' ? String(c['#text'] ?? '') : ''))
		.join('');
}

export function parseOrdered(xml: string): XNode[] {
	return orderedXml.parse(xml) as XNode[];
}

/** A table cell placed on the grid (0-based anchor, spans >= 1). */
export interface GridCell {
	text: string;
	row: number;
	col: number;
	rowSpan: number;
	colSpan: number;
}

/**
 * Check that cells tile an nRows x nCols grid exactly once (no overlap, in
 * bounds, every slot covered). Returns a problem description or null.
 */
export function gridProblem(cells: GridCell[], nRows: number, nCols: number): string | null {
	if (nRows < 1 || nCols < 1) return `행/열 수가 올바르지 않음 (${nRows}x${nCols})`;
	if (nRows * nCols > 1_000_000) return `표가 너무 큼 (${nRows}x${nCols})`;
	const used = new Uint8Array(nRows * nCols);
	for (const c of cells) {
		if (c.rowSpan < 1 || c.colSpan < 1) return '병합 크기가 0';
		if (c.row < 0 || c.col < 0 || c.row + c.rowSpan > nRows || c.col + c.colSpan > nCols) return '셀 주소가 표 범위를 벗어남';
		for (let r = c.row; r < c.row + c.rowSpan; r++) {
			for (let k = c.col; k < c.col + c.colSpan; k++) {
				if (used[r * nCols + k]) return '셀이 서로 겹침';
				used[r * nCols + k] = 1;
			}
		}
	}
	if (used.some((u) => u === 0)) return '비어 있는 격자 칸이 있음';
	return null;
}

/** Place row-major cells with spans on a grid (HTML table algorithm) when no explicit addresses exist. */
export function layoutRows(rows: { text: string; rowSpan: number; colSpan: number }[][]): { cells: GridCell[]; nRows: number; nCols: number } {
	const taken = new Set<string>();
	const cells: GridCell[] = [];
	let nCols = 0;
	rows.forEach((row, r) => {
		let col = 0;
		for (const c of row) {
			while (taken.has(`${r},${col}`)) col++;
			const cell = { text: c.text, row: r, col, rowSpan: Math.max(1, c.rowSpan), colSpan: Math.max(1, c.colSpan) };
			cells.push(cell);
			for (let i = r; i < r + cell.rowSpan; i++) for (let k = col; k < col + cell.colSpan; k++) taken.add(`${i},${k}`);
			col += cell.colSpan;
			nCols = Math.max(nCols, col);
		}
	});
	const nRows = Math.max(rows.length, ...cells.map((c) => c.row + c.rowSpan));
	return { cells, nRows, nCols };
}

/** Merged body paragraph blocks stop growing past this many characters. */
export const MERGE_LIMIT = 600;

/**
 * Compact whitespace without changing words: NBSP/ideographic spaces become
 * spaces, runs of spaces/tabs collapse, lines are trimmed and empty lines dropped.
 */
export function normText(s: string): string {
	return s
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((l) =>
			l
				.replace(/[  　 - ]+/g, ' ')
				.replace(/ ?\t[ \t]*/g, '\t')
				.trim()
		)
		.filter((l) => l !== '')
		.join('\n');
}

/** Normalise cell text for a column label (single line). */
function labelOf(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

export class DocBuilder {
	texts: TextBlock[] = [];
	tables: Table[] = [];
	warnings: string[] = [];
	private paragraphs = 0;
	private tableCount = 0;
	private partCounts = new Map<string, number>();
	private imageQueue: { name: string; bytes: () => Promise<Buffer | undefined>; loc: Loc }[] = [];
	private seenImages = new Set<string>();
	private warnedOnce = new Set<string>();

	constructor(public readonly fi: number) {}

	private pending: { from: number; to: number; texts: string[]; len: number; loc: Loc; key: string } | null = null;

	/**
	 * Body paragraph n (1-based; empty paragraphs are counted but not emitted so
	 * numbers match the document). Consecutive short paragraphs with the same
	 * placement are merged into one block (location {from, to}) up to
	 * MERGE_LIMIT chars to keep the manifest compact; headings stay on their own.
	 */
	paragraph(text: string, loc: Loc = {}): number {
		this.paragraphs += 1;
		const n = this.paragraphs;
		const t = normText(text);
		if (t === '') return n;
		const { style: _s, list_level: _l, ...place } = loc;
		const key = JSON.stringify(place);
		if (loc.heading !== undefined && loc.heading !== null) {
			this.flushParagraphs();
			this.texts.push({ evidence_id: `f${this.fi}.d.p${n}`, kind: 'paragraph', location: { paragraph: n, ...loc }, text: t, ocr_confidence: null });
			return n;
		}
		const p = this.pending;
		if (p && (p.key !== key || p.len + 1 + t.length > MERGE_LIMIT)) this.flushParagraphs();
		if (!this.pending) {
			this.pending = { from: n, to: n, texts: [t], len: t.length, loc: { ...loc }, key };
		} else {
			const q = this.pending;
			q.to = n;
			q.texts.push(t);
			q.len += 1 + t.length;
			if (q.loc.style !== loc.style) delete q.loc.style;
			delete q.loc.list_level;
		}
		return n;
	}

	/** Close the current merged paragraph block (table/section boundaries, end of document). */
	flushParagraphs(): void {
		const p = this.pending;
		if (!p) return;
		this.pending = null;
		this.texts.push({
			evidence_id: `f${this.fi}.d.p${p.from}`,
			kind: 'paragraph',
			location: p.from === p.to ? { paragraph: p.from, ...p.loc } : { from: p.from, to: p.to, ...p.loc },
			text: p.texts.join('\n'),
			ocr_confidence: null
		});
	}

	get currentParagraph(): number {
		return this.paragraphs;
	}

	/** Side text (header/footer/footnote/endnote/text box/caption) as one block. */
	part(prefix: 'hdr' | 'ftr' | 'fn' | 'en' | 'tb' | 'cap' | 'tt', text: string, loc: Loc): void {
		const t = normText(text);
		if (t === '') return;
		const n = (this.partCounts.get(prefix) ?? 0) + 1;
		this.partCounts.set(prefix, n);
		this.texts.push({ evidence_id: `f${this.fi}.d.${prefix}${n}`, kind: 'paragraph', location: loc, text: t, ocr_confidence: null });
	}

	block(b: TextBlock): void {
		this.texts.push(b);
	}

	warn(w: string): void {
		this.warnings.push(w);
	}

	warnOnce(key: string, w: string): void {
		if (this.warnedOnce.has(key)) return;
		this.warnedOnce.add(key);
		this.warnings.push(w);
	}

	/**
	 * Add a table. If the grid cannot be reconstructed reliably the cell texts
	 * are kept as text blocks (in reading order) with a warning — never a guessed grid.
	 */
	table(cells: GridCell[], nRows: number, nCols: number, where: string): void {
		this.flushParagraphs();
		const problem = gridProblem(cells, nRows, nCols);
		const k = this.tableCount++;
		if (problem) {
			const text = [...cells]
				.sort((a, b) => a.row - b.row || a.col - b.col)
				.map((c) => c.text)
				.filter((t) => t.trim() !== '')
				.join('\n');
			this.part('tt', text, { part: 'table_text', table: k + 1, after_paragraph: this.paragraphs });
			this.warn(`${where} 표 ${k + 1}의 행/열 구조를 복원하지 못해 셀 텍스트만 문단으로 보존함 (${problem})`);
			return;
		}
		const grid: string[][] = Array.from({ length: nRows }, () => Array.from({ length: nCols }, () => ''));
		const merged: string[] = [];
		for (const c of cells) {
			grid[c.row]![c.col] = normText(c.text);
			if (c.rowSpan > 1 || c.colSpan > 1) {
				merged.push(`${colLetter(c.col + 1)}${c.row + 1}:${colLetter(c.col + c.colSpan)}${c.row + c.rowSpan}`);
			}
		}
		const id = `f${this.fi}.d.t${k}`;
		const header = grid[0]!;
		const columns = header.map((h, i) => ({ column_id: colLetter(i + 1), label: labelOf(h) || colLetter(i + 1), index: i + 1 }));
		this.tables.push({
			table_id: id,
			kind: 'doc_table',
			label: `${where} 표 ${k + 1}`.trim(),
			header_row: 1,
			columns,
			merged_ranges: merged,
			rows: grid.slice(1).map((cellsRow, ri) => ({
				record_id: `${id}.r${ri + 2}`,
				row_number: ri + 2,
				hidden: false,
				evidence_id: `${id}.r${ri + 2}`,
				cells: columns.map((c, ci) => typedFromText(cellsRow[ci] ?? '', c.column_id, `${id}!${c.column_id}${ri + 2}`))
			}))
		});
	}

	/** Queue an embedded raster image for OCR (deduplicated by name). */
	image(name: string, bytes: () => Promise<Buffer | undefined>, loc: Loc): void {
		if (this.seenImages.has(name)) return;
		this.seenImages.add(name);
		this.imageQueue.push({ name, bytes, loc });
	}

	/** OCR queued images (shared OCR budget, like pptx) and return the output. */
	async finish(ocrOk: boolean, ocrBudget: { used: number }, maxOcrPages: number): Promise<ParseOutput> {
		this.flushParagraphs();
		const ocrable = /\.(png|jpe?g|webp|gif|tiff?)$/i;
		const skipped: string[] = [];
		for (const img of this.imageQueue) {
			if (!ocrable.test(img.name)) {
				skipped.push(path.posix.basename(img.name));
				continue;
			}
			if (!ocrOk) {
				this.warnOnce('no-ocr', '문서 안 이미지의 텍스트는 OCR 도구가 없어 읽지 않음');
				continue;
			}
			const bytes = await img.bytes();
			if (!bytes) {
				this.warn(`포함된 이미지 ${img.name}을(를) 찾을 수 없음`);
				continue;
			}
			const base = path.posix.basename(img.name);
			const res = await ocrImage(bytes, this.fi, ocrBudget, maxOcrPages);
			for (const t of res.texts) {
				this.texts.push({
					...t,
					evidence_id: t.evidence_id.replace(`f${this.fi}.img`, `f${this.fi}.d.${base.replace(/\W/g, '_')}`),
					location: { ...t.location, ...img.loc, image: base }
				});
			}
			this.warnings.push(...res.warnings.map((w) => `이미지 ${base}: ${w}`));
		}
		if (skipped.length) this.warn(`OCR을 지원하지 않는 이미지 형식이라 읽지 않음: ${skipped.join(', ')}`);
		return { tables: this.tables, texts: this.texts, warnings: this.warnings };
	}
}
