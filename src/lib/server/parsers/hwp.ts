import * as CFB from 'cfb';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { AppError } from '../errors';
import { toolAvailable } from './exec';
import { DocBuilder, gridProblem, type GridCell } from './docmodel';
import type { ParseInput, ParseOutput } from './types';

/**
 * HWP 5.x binary (CFB) parser following the public "한글 문서 파일 형식 5.0"
 * spec: FileHeader flags, zlib(raw deflate) BodyText/Section{n} record streams,
 * PARA_TEXT with inline/extended control characters, tables rebuilt from
 * CTRL_HEADER('tbl ') + TABLE + LIST_HEADER cell addresses. Scripts are never run.
 */

const CFB_SIG = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
export const HWP3_SIGNATURE = Buffer.from('HWP Document File V3.00 \x1a\x01\x02\x03\x04\x05', 'latin1');

const TAG = {
	STYLE: 0x1a,
	PARA_HEADER: 0x42,
	PARA_TEXT: 0x43,
	CTRL_HEADER: 0x47,
	LIST_HEADER: 0x48,
	TABLE: 0x4d
} as const;

export type HangulVariant = 'hwp5' | 'hwp3' | 'hwpx' | 'unknown';

export function hangulVariant(bytes: Buffer): HangulVariant {
	if (bytes.subarray(0, 8).equals(CFB_SIG)) return 'hwp5';
	if (bytes.subarray(0, 23).equals(HWP3_SIGNATURE.subarray(0, 23))) return 'hwp3';
	if (bytes.subarray(0, 4).equals(Buffer.from('PK\x03\x04', 'latin1'))) return 'hwpx';
	return 'unknown';
}

function failed(msg: string): AppError {
	return new AppError('PARSE_FAILED', msg, 'preparing');
}

interface Rec {
	tag: number;
	level: number;
	data: Buffer;
	children: Rec[];
}

/** Split a record stream; a size that runs past the end means a truncated/corrupt stream. */
export function readRecords(buf: Buffer): Rec[] {
	const out: Rec[] = [];
	let o = 0;
	while (o < buf.length) {
		if (o + 4 > buf.length) throw failed('한글 문서 레코드가 잘림 (손상)');
		const h = buf.readUInt32LE(o);
		o += 4;
		let size = h >>> 20;
		if (size === 0xfff) {
			if (o + 4 > buf.length) throw failed('한글 문서 레코드가 잘림 (손상)');
			size = buf.readUInt32LE(o);
			o += 4;
		}
		if (o + size > buf.length) throw failed('한글 문서 레코드 크기가 스트림을 넘음 (손상)');
		out.push({ tag: h & 0x3ff, level: (h >>> 10) & 0x3ff, data: buf.subarray(o, o + size), children: [] });
		o += size;
	}
	return out;
}

/** Nest records by level (a record's children follow it with level + 1 or deeper). */
function tree(recs: Rec[]): Rec[] {
	const roots: Rec[] = [];
	const stack: Rec[] = [];
	for (const r of recs) {
		while (stack.length && stack[stack.length - 1]!.level >= r.level) stack.pop();
		if (stack.length) stack[stack.length - 1]!.children.push(r);
		else roots.push(r);
		stack.push(r);
	}
	return roots;
}

function ctrlId(r: Rec): string {
	if (r.data.length < 4) return '';
	const id = r.data.readUInt32LE(0);
	return String.fromCharCode(id >>> 24, (id >>> 16) & 255, (id >>> 8) & 255, id & 255);
}

/**
 * PARA_TEXT (UTF-16LE). Control chars 0-31: 0,10,13,24-31 occupy one WCHAR;
 * 1-9,11-12,14-23 are inline/extended controls occupying 8 WCHARs.
 */
export function decodeParaText(data: Buffer): string {
	const units: number[] = [];
	const n = data.length >> 1;
	for (let i = 0; i < n; i++) {
		const ch = data.readUInt16LE(i * 2);
		if (ch >= 32) {
			units.push(ch);
			continue;
		}
		switch (ch) {
			case 10:
				units.push(10);
				break;
			case 24:
				units.push(0x2d);
				break;
			case 30:
			case 31:
				units.push(0x20);
				break;
			case 9:
				units.push(9);
				i += 7;
				break;
			case 0:
			case 13:
			case 25:
			case 26:
			case 27:
			case 28:
			case 29:
				break;
			default:
				i += 7;
				break;
		}
	}
	let s = '';
	for (let i = 0; i < units.length; i += 8192) s += String.fromCharCode(...units.slice(i, i + 8192));
	return s;
}

function u16(b: Buffer, o: number): number {
	return o + 2 <= b.length ? b.readUInt16LE(o) : -1;
}

interface Ctx {
	b: DocBuilder;
	styles: string[];
	section: number;
	nested: number;
	comments: number;
	equations: number;
}

function paraOwnText(p: Rec): string {
	return p.children
		.filter((c) => c.tag === TAG.PARA_TEXT)
		.map((c) => decodeParaText(c.data))
		.join('');
}

/** Paragraph text for cells/side parts: nested tables and text boxes flattened inline. */
function paraDeepText(p: Rec, ctx: Ctx): string {
	const parts = [paraOwnText(p)];
	for (const c of p.children) {
		if (c.tag !== TAG.CTRL_HEADER) continue;
		const id = ctrlId(c);
		if (id === 'tbl ') {
			ctx.nested += 1;
			const t = tableCells(c, ctx);
			if (t) {
				const rows = new Map<number, GridCell[]>();
				for (const cell of t.cells) rows.set(cell.row, [...(rows.get(cell.row) ?? []), cell]);
				parts.push(
					[...rows.entries()]
						.sort((a, b) => a[0] - b[0])
						.map(([, cs]) =>
							cs
								.sort((a, b) => a.col - b.col)
								.map((x) => x.text.replace(/\n/g, ' '))
								.join('\t')
						)
						.join('\n')
				);
			}
		} else if (id === 'gso ') parts.push(nestedParas(c).map((x) => paraDeepText(x, ctx)).join('\n'));
		else countCtrl(id, ctx);
	}
	return parts.filter((x) => x !== '').join('\n');
}

function countCtrl(id: string, ctx: Ctx): void {
	if (id === 'tcmt') ctx.comments += 1;
	else if (id === 'eqed') ctx.equations += 1;
}

/** PARA_HEADER records under a control (not descending into those paragraphs). */
function nestedParas(r: Rec, out: Rec[] = []): Rec[] {
	for (const c of r.children) {
		if (c.tag === TAG.PARA_HEADER) out.push(c);
		else nestedParas(c, out);
	}
	return out;
}

interface TableData {
	cells: GridCell[];
	nRows: number;
	nCols: number;
	caption: string;
}

/** Rebuild a table from CTRL_HEADER('tbl ') children. Null when no TABLE record exists. */
function tableCells(ctrl: Rec, ctx: Ctx): TableData | null {
	const kids = ctrl.children;
	const ti = kids.findIndex((k) => k.tag === TAG.TABLE);
	if (ti < 0) return null;
	const table = kids[ti]!;
	const nRows = u16(table.data, 4);
	const nCols = u16(table.data, 6);
	const caption = kids
		.slice(0, ti)
		.filter((k) => k.tag === TAG.PARA_HEADER)
		.map((p) => paraDeepText(p, ctx))
		.join('\n');
	const groups: { lh: Buffer; paras: Rec[] }[] = [];
	for (const k of kids.slice(ti + 1)) {
		if (k.tag === TAG.LIST_HEADER) groups.push({ lh: k.data, paras: [] });
		else if (k.tag === TAG.PARA_HEADER && groups.length) groups[groups.length - 1]!.paras.push(k);
	}
	const texts = groups.map((g) => g.paras.map((p) => paraDeepText(p, ctx)).join('\n'));
	// Cell address follows the list header (paragraph count + flags): col,row,colSpan,rowSpan.
	// Offset 8 matches files written by Hangul; 6 is the layout printed in the spec table.
	let best: GridCell[] | null = null;
	for (const off of [8, 6]) {
		const cells = groups.map((g, i) => ({
			text: texts[i]!,
			col: u16(g.lh, off),
			row: u16(g.lh, off + 2),
			colSpan: u16(g.lh, off + 4),
			rowSpan: u16(g.lh, off + 6)
		}));
		best ??= cells;
		if (!gridProblem(cells, nRows, nCols)) return { cells, nRows, nCols, caption };
	}
	return { cells: best ?? [], nRows, nCols, caption };
}

function stream(c: CFB.CFB$Container, name: string): Buffer | null {
	const e = CFB.find(c, name);
	return e && e.content ? Buffer.from(e.content as Uint8Array) : null;
}

function inflate(buf: Buffer, what: string): Buffer {
	try {
		return inflateRawSync(buf);
	} catch {
		try {
			return inflateSync(buf);
		} catch {
			throw failed(`한글 문서 ${what} 압축을 풀 수 없음 (손상 또는 암호화)`);
		}
	}
}

function readWString(b: Buffer, o: number): { s: string; next: number } | null {
	const len = u16(b, o);
	if (len < 0 || o + 2 + len * 2 > b.length) return null;
	return { s: b.subarray(o + 2, o + 2 + len * 2).toString('utf16le'), next: o + 2 + len * 2 };
}

function imageMagic(b: Buffer): boolean {
	return (
		b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
		(b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
	);
}

export async function parseHwp5(input: ParseInput): Promise<ParseOutput> {
	let c: CFB.CFB$Container;
	try {
		c = CFB.read(input.bytes, { type: 'buffer' });
	} catch {
		throw failed('한글(hwp) 파일을 열 수 없음 (손상)');
	}
	const fh = stream(c, '/FileHeader');
	if (!fh || fh.length < 40 || !fh.subarray(0, 17).equals(Buffer.from('HWP Document File', 'latin1'))) {
		throw failed('한글(hwp) 5.x 파일이 아님 (FileHeader 없음 — 손상되었거나 다른 형식)');
	}
	const version = fh.readUInt32LE(32);
	const major = version >>> 24;
	if (major !== 5) throw failed(`지원하지 않는 한글 문서 버전 (${major}.x)`);
	const flags = fh.readUInt32LE(36);
	if (flags & 0x2) throw failed('암호가 걸린 한글 파일 — 암호를 해제한 뒤 다시 선택하세요');
	if (flags & 0x4) throw failed('배포용 한글 문서는 지원하지 않음 (내용이 암호화되어 있음)');
	if (flags & 0x10) throw failed('DRM 보안이 적용된 한글 문서는 지원하지 않음');
	if (flags & 0x100) throw failed('공인인증서로 암호화된 한글 문서는 지원하지 않음');
	const compressed = (flags & 0x1) !== 0;

	try {
		return await parseBody(c, compressed, input);
	} catch (e) {
		if (e instanceof AppError) throw e;
		throw failed(`한글(hwp) 문서 내용을 읽을 수 없음 (손상): ${(e as Error).message.slice(0, 120)}`);
	}
}

async function parseBody(c: CFB.CFB$Container, compressed: boolean, input: ParseInput): Promise<ParseOutput> {
	const di = stream(c, '/DocInfo');
	if (!di) throw failed('한글 문서 DocInfo 스트림이 없음 (손상)');
	const styles: string[] = [];
	for (const r of readRecords(compressed ? inflate(di, 'DocInfo') : di)) {
		if (r.tag !== TAG.STYLE) continue;
		styles.push(readWString(r.data, 0)?.s ?? '');
	}

	const sectionNames = c.FullPaths.map((p) => /\/BodyText\/Section(\d+)$/.exec(p)).filter((m): m is RegExpExecArray => !!m);
	const nums = sectionNames.map((m) => Number(m[1])).sort((a, b) => a - b);
	if (!nums.length) throw failed('한글 문서 본문(BodyText) 스트림이 없음 (손상)');
	nums.forEach((n, i) => {
		if (n !== i) throw failed(`한글 문서 본문 구역 ${i}이(가) 없음 (손상)`);
	});

	const b = new DocBuilder(input.fileIndex);
	const ctx: Ctx = { b, styles, section: 0, nested: 0, comments: 0, equations: 0 };
	for (const n of nums) {
		ctx.section = n + 1;
		const raw = stream(c, `/BodyText/Section${n}`);
		if (!raw) throw failed(`한글 문서 본문 구역 ${n}을(를) 읽을 수 없음 (손상)`);
		const roots = tree(readRecords(compressed ? inflate(raw, `구역 ${n + 1}`) : raw));
		if (roots.length && roots[0]!.tag !== TAG.PARA_HEADER) throw failed(`한글 문서 구역 ${n + 1}의 레코드 구조가 올바르지 않음 (손상)`);
		for (const p of roots) {
			if (p.tag !== TAG.PARA_HEADER) continue;
			const styleId = p.data.length > 10 ? p.data[10]! : 0;
			const style = styleId ? (styles[styleId] ?? null) : null;
			const m = style ? /^(?:개요|outline)\s*(\d+)$/i.exec(style) : null;
			const loc: Record<string, string | number> = { section: n + 1 };
			if (style) loc.style = style;
			if (m) loc.heading = Number(m[1]);
			const pn = b.paragraph(paraOwnText(p), loc);
			for (const ctrl of p.children) {
				if (ctrl.tag !== TAG.CTRL_HEADER) continue;
				const id = ctrlId(ctrl);
				const sideLoc = { section: n + 1, paragraph: pn };
				switch (id) {
					case 'tbl ': {
						const t = tableCells(ctrl, ctx);
						if (!t) {
							b.warn(`구역 ${n + 1} 문단 ${pn}의 표 정보(TABLE 레코드)가 없어 표를 읽지 못함`);
							break;
						}
						b.part('cap', t.caption, { part: 'caption', ...sideLoc });
						b.table(t.cells, t.nRows, t.nCols, '');
						break;
					}
					case 'head':
					case 'foot':
					case 'fn  ':
					case 'en  ': {
						const kind = { 'head': 'header', 'foot': 'footer', 'fn  ': 'footnote', 'en  ': 'endnote' }[id]!;
						const prefix = ({ header: 'hdr', footer: 'ftr', footnote: 'fn', endnote: 'en' } as const)[kind as 'header'];
						b.part(prefix, nestedParas(ctrl).map((x) => paraDeepText(x, ctx)).join('\n'), { part: kind, ...sideLoc });
						break;
					}
					case 'gso ':
						b.part('tb', nestedParas(ctrl).map((x) => paraDeepText(x, ctx)).join('\n'), { part: 'textbox', ...sideLoc });
						break;
					default:
						countCtrl(id, ctx);
				}
			}
		}
	}

	// Embedded images (BinData/BINxxxx.ext): OCR raster ones like pptx.
	c.FullPaths.forEach((p, i) => {
		const m = /\/BinData\/([^/]+)$/.exec(p);
		if (!m || c.FileIndex[i]!.type !== 2) return;
		const name = m[1]!;
		b.image(name, async () => {
			const raw = Buffer.from(c.FileIndex[i]!.content as Uint8Array);
			if (imageMagic(raw)) return raw;
			try {
				const x = inflateRawSync(raw);
				return imageMagic(x) ? x : raw;
			} catch {
				return raw;
			}
		}, { image_stream: name });
	});

	if (ctx.comments) b.warn(`숨은 설명(메모) ${ctx.comments}개는 분석에서 제외함`);
	if (ctx.nested) b.warn(`중첩 표 ${ctx.nested}개는 바깥 표 셀의 텍스트로 평탄화함`);
	if (ctx.equations) b.warn(`수식 ${ctx.equations}개는 텍스트로 옮기지 않음 (분석 제외)`);
	return b.finish(await toolAvailable('tesseract'), input.ocrBudget, input.maxOcrPages);
}
