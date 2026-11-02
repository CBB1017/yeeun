import JSZip from 'jszip';
import path from 'node:path';
import * as CFB from 'cfb';
import { AppError } from '../errors';
import { toolAvailable } from './exec';
import { chartXmlToText, ooxmlParser, partRels } from './xlsx';
import { attr, child, children, DocBuilder, kids, parseOrdered, tagOf, textOf, type GridCell, type XNode } from './docmodel';
import type { ParseInput, ParseOutput } from './types';

/**
 * WordprocessingML (.docx/.docm) parser. Reads XML only — macros are never
 * executed. Body paragraphs and tables keep document order; tracked changes
 * are read in their accepted state (insertions kept, deletions dropped).
 */

export const CFB_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

interface StyleInfo {
	name: string;
	outline: number | null;
	basedOn: string | null;
}

interface Ctx {
	b: DocBuilder;
	styles: Map<string, StyleInfo>;
	tracked: number;
	symbols: number;
	math: number;
	objects: number;
	nested: number;
	hidden: number;
	pendingTextboxes: XNode[][];
	pendingImages: string[];
	pendingCharts: string[];
}

function failed(msg: string): AppError {
	return new AppError('PARSE_FAILED', msg, 'preparing');
}

/** Encrypted OOXML (Agile/Standard encryption) is stored as a CFB container. */
export function isEncryptedOoxml(bytes: Buffer): boolean {
	try {
		const c = CFB.read(bytes, { type: 'buffer' });
		return c.FullPaths.some((p) => /\/(EncryptionInfo|EncryptedPackage)$/.test(p));
	} catch {
		return false;
	}
}

function int(v: string | undefined, d: number): number {
	const n = v === undefined ? NaN : Number.parseInt(v, 10);
	return Number.isFinite(n) ? n : d;
}

/** Search a drawing/pict/object subtree, skipping mc:Fallback copies of mc:Choice content. */
function walkDrawing(nodes: XNode[], fn: (n: XNode) => boolean): void {
	for (const n of nodes) {
		const t = tagOf(n);
		if (t === 'Fallback') continue;
		if (fn(n)) continue;
		walkDrawing(kids(n), fn);
	}
}

function collectDrawing(node: XNode, ctx: Ctx): void {
	walkDrawing([node], (n) => {
		const t = tagOf(n);
		if (t === 'txbxContent') {
			ctx.pendingTextboxes.push(kids(n));
			return true;
		}
		if (t === 'blip') {
			const rid = attr(n, 'embed') ?? attr(n, 'link');
			if (rid) ctx.pendingImages.push(rid);
		}
		if (t === 'imagedata') {
			const rid = attr(n, 'id');
			if (rid) ctx.pendingImages.push(rid);
		}
		if (t === 'chart') {
			const rid = attr(n, 'id');
			if (rid) ctx.pendingCharts.push(rid);
			return true;
		}
		return false;
	});
}

function choiceOf(n: XNode): XNode[] {
	const c = child(n, 'Choice');
	return c ? kids(c) : kids(child(n, 'Fallback'));
}

/** Content of a w:r (and of mc:AlternateContent at run level). */
function runContent(nodes: XNode[], ctx: Ctx): string {
	let s = '';
	for (const c of nodes) {
		switch (tagOf(c)) {
			case 't':
				s += textOf(c);
				break;
			case 'tab':
			case 'ptab':
				s += '\t';
				break;
			case 'br':
			case 'cr':
				s += '\n';
				break;
			case 'noBreakHyphen':
				s += '-';
				break;
			case 'sym':
				ctx.symbols += 1;
				break;
			case 'drawing':
			case 'pict':
				collectDrawing(c, ctx);
				break;
			case 'object':
				ctx.objects += 1;
				break;
			case 'AlternateContent':
				s += runContent(choiceOf(c), ctx);
				break;
			case 'ruby':
				s += inlineText(kids(child(c, 'rubyBase')), ctx);
				break;
			// softHyphen (invisible), delText/instrText (deleted text, field codes),
			// fldChar, note/comment references, rPr: no visible text of their own
			default:
				break;
		}
	}
	return s;
}

/** Visible (accepted-state) text of paragraph content in document order. */
function inlineText(nodes: XNode[], ctx: Ctx): string {
	let s = '';
	for (const n of nodes) {
		switch (tagOf(n)) {
			case 'r': {
				const rPr = child(n, 'rPr');
				if (child(rPr, 'vanish')) ctx.hidden += 1;
				s += runContent(kids(n), ctx);
				break;
			}
			case 'ins':
			case 'moveTo':
				ctx.tracked += 1;
				s += inlineText(kids(n), ctx);
				break;
			case 'del':
			case 'moveFrom':
				ctx.tracked += 1;
				break;
			case 'hyperlink':
			case 'smartTag':
			case 'customXml':
			case 'fldSimple':
			case 'dir':
			case 'bdo':
			case 'sdtContent':
				s += inlineText(kids(n), ctx);
				break;
			case 'sdt':
				s += inlineText(kids(child(n, 'sdtContent')), ctx);
				break;
			case 'AlternateContent':
				s += inlineText(choiceOf(n), ctx);
				break;
			case 'oMath':
			case 'oMathPara':
				ctx.math += 1;
				break;
			default:
				break;
		}
	}
	return s;
}

/** Text of block content (cells, headers, notes, text boxes); nested tables flattened. */
function blocksText(nodes: XNode[], ctx: Ctx, inCell: boolean): string {
	const out: string[] = [];
	for (const n of nodes) {
		switch (tagOf(n)) {
			case 'p':
				out.push(inlineText(kids(n), ctx));
				break;
			case 'tbl': {
				if (inCell) ctx.nested += 1;
				for (const tr of wrapped(kids(n), 'tr')) {
					out.push(
						wrapped(kids(tr), 'tc')
							.map((tc) => blocksText(kids(tc), ctx, inCell).replace(/\n/g, ' '))
							.join('\t')
					);
				}
				break;
			}
			case 'sdt':
				out.push(blocksText(kids(child(n, 'sdtContent')), ctx, inCell));
				break;
			case 'customXml':
			case 'ins':
			case 'moveTo':
				out.push(blocksText(kids(n), ctx, inCell));
				break;
			case 'AlternateContent':
				out.push(blocksText(choiceOf(n), ctx, inCell));
				break;
			case 'altChunk':
				throw altChunk();
			default:
				break;
		}
	}
	return out.join('\n');
}

function altChunk(): AppError {
	return new AppError(
		'UNSUPPORTED_FORMAT',
		'Word 문서에 다른 형식 조각(altChunk)이 들어 있어 내용을 정확히 읽을 수 없음 — Word에서 다시 저장한 뒤 선택하세요',
		'preparing'
	);
}

/** Children with this tag, looking through sdt/customXml wrappers. */
function wrapped(nodes: XNode[], tag: string): XNode[] {
	const out: XNode[] = [];
	for (const n of nodes) {
		const t = tagOf(n);
		if (t === tag) out.push(n);
		else if (t === 'sdt') out.push(...wrapped(kids(child(n, 'sdtContent')), tag));
		else if (t === 'customXml') out.push(...wrapped(kids(n), tag));
	}
	return out;
}

function readTable(tbl: XNode, ctx: Ctx): { cells: GridCell[]; nRows: number; nCols: number } {
	const cells: GridCell[] = [];
	const open = new Map<number, GridCell>();
	let nCols = 0;
	let r = 0;
	for (const tr of wrapped(kids(tbl), 'tr')) {
		const trPr = child(tr, 'trPr');
		if (child(trPr, 'del')) {
			ctx.tracked += 1;
			continue;
		}
		if (child(trPr, 'ins')) ctx.tracked += 1;
		let col = int(attr(child(trPr, 'gridBefore'), 'val'), 0);
		let last: GridCell | undefined;
		for (const tc of wrapped(kids(tr), 'tc')) {
			const tcPr = child(tc, 'tcPr');
			const span = Math.max(1, int(attr(child(tcPr, 'gridSpan'), 'val'), 1));
			const vm = child(tcPr, 'vMerge');
			const vmVal = vm ? (attr(vm, 'val') ?? 'continue') : undefined;
			const hm = child(tcPr, 'hMerge');
			const hmVal = hm ? (attr(hm, 'val') ?? 'continue') : undefined;
			const text = blocksText(kids(tc), ctx, true);
			if (vmVal === 'continue') {
				const a = open.get(col);
				if (a && a.colSpan === span && a.row + a.rowSpan === r) {
					a.rowSpan += 1;
					if (text.trim()) a.text = a.text ? `${a.text}\n${text}` : text;
					last = a;
					col += span;
					continue;
				}
			}
			if (hmVal === 'continue' && last && last.row === r && last.col + last.colSpan === col) {
				last.colSpan += span;
				if (text.trim()) last.text = last.text ? `${last.text}\n${text}` : text;
				col += span;
				continue;
			}
			const cell: GridCell = { text, row: r, col, rowSpan: 1, colSpan: span };
			cells.push(cell);
			for (let k = col; k < col + span; k++) open.delete(k);
			if (vmVal === 'restart') open.set(col, cell);
			last = cell;
			col += span;
		}
		nCols = Math.max(nCols, col + int(attr(child(trPr, 'gridAfter'), 'val'), 0));
		r += 1;
	}
	// Ragged rows (gridBefore/gridAfter or short rows) leave real, empty grid slots.
	const used = new Set<string>();
	for (const c of cells) {
		for (let i = c.row; i < c.row + c.rowSpan; i++) for (let k = c.col; k < c.col + c.colSpan; k++) used.add(`${i},${k}`);
	}
	for (let i = 0; i < r; i++) {
		for (let k = 0; k < nCols; k++) if (!used.has(`${i},${k}`)) cells.push({ text: '', row: i, col: k, rowSpan: 1, colSpan: 1 });
	}
	return { cells, nRows: r, nCols };
}

function headingOf(styleId: string | undefined, pPr: XNode | undefined, ctx: Ctx): { style: string | null; heading: number | null } {
	let outline: number | null = null;
	const own = attr(child(pPr, 'outlineLvl'), 'val');
	if (own !== undefined) outline = int(own, 9);
	let name: string | null = null;
	let id = styleId;
	const seen = new Set<string>();
	while (id && !seen.has(id)) {
		seen.add(id);
		const s = ctx.styles.get(id);
		if (!s) break;
		name ??= s.name;
		if (outline === null && s.outline !== null) outline = s.outline;
		id = s.basedOn ?? undefined;
	}
	const style = name ?? styleId ?? null;
	const m = style ? /^(?:heading|제목)\s*(\d)$/i.exec(style) : null;
	const heading = m ? Number(m[1]) : outline !== null && outline >= 0 && outline < 9 ? outline + 1 : null;
	return { style, heading };
}

async function loadStyles(zip: JSZip, target: string | undefined): Promise<Map<string, StyleInfo>> {
	const map = new Map<string, StyleInfo>();
	const f = target ? zip.file(target) : null;
	if (!f) return map;
	const x = ooxmlParser.parse(await f.async('string'));
	const list = x?.styles?.style;
	for (const s of Array.isArray(list) ? list : list ? [list] : []) {
		const id = s?.['@styleId'];
		if (!id) continue;
		const ol = s?.pPr?.outlineLvl?.['@val'];
		map.set(String(id), {
			name: String(s?.name?.['@val'] ?? id),
			outline: ol === undefined ? null : int(String(ol), 9),
			basedOn: s?.basedOn?.['@val'] ? String(s.basedOn['@val']) : null
		});
	}
	return map;
}

function rootOf(nodes: XNode[], tag: string): XNode | undefined {
	return nodes.find((n) => tagOf(n) === tag);
}

export async function parseDocx(input: ParseInput): Promise<ParseOutput> {
	if (input.bytes.subarray(0, 8).equals(CFB_SIGNATURE)) {
		if (isEncryptedOoxml(input.bytes)) throw failed('암호가 걸린 Word 파일 — 암호를 해제한 뒤 다시 선택하세요');
		throw failed('docx 형식이 아님 (구형 doc이거나 손상된 파일)');
	}
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(input.bytes);
	} catch {
		throw failed('Word 파일을 열 수 없음 (손상 또는 암호화)');
	}
	try {
		return await parseZip(zip, input);
	} catch (e) {
		if (e instanceof AppError) throw e;
		throw failed(`Word 파일 내용을 읽을 수 없음 (손상): ${(e as Error).message.slice(0, 120)}`);
	}
}

async function parseZip(zip: JSZip, input: ParseInput): Promise<ParseOutput> {
	const pkgRels = await partRels(zip, '');
	const main = [...pkgRels.values()].find((r) => r.type.endsWith('/officeDocument') && !r.external)?.target ?? 'word/document.xml';
	const docFile = zip.file(main);
	if (!docFile) throw failed('Word 본문(document.xml)이 없음 (손상되었거나 Word 문서가 아님)');
	const docRels = await partRels(zip, main);
	const relOf = (type: string) => [...docRels.values()].filter((r) => !r.external && r.type.endsWith(`/${type}`));
	const fi = input.fileIndex;
	const b = new DocBuilder(fi);
	const ctx: Ctx = {
		b,
		styles: await loadStyles(zip, relOf('styles')[0]?.target),
		tracked: 0,
		symbols: 0,
		math: 0,
		objects: 0,
		nested: 0,
		hidden: 0,
		pendingTextboxes: [],
		pendingImages: [],
		pendingCharts: []
	};
	const doc = rootOf(parseOrdered(await docFile.async('string')), 'document');
	const body = child(doc, 'body');
	if (!body) throw failed('Word 본문(body)이 없음 (손상)');

	const charts: { target: string; paragraph: number }[] = [];
	let externalImages = 0;
	const flush = (paragraph: number) => {
		while (ctx.pendingTextboxes.length) {
			const tx = ctx.pendingTextboxes.shift()!;
			b.part('tb', blocksText(tx, ctx, false), { part: 'textbox', paragraph });
		}
		for (const rid of ctx.pendingImages.splice(0)) {
			const rel = docRels.get(rid);
			if (!rel) continue;
			if (rel.external) {
				externalImages += 1;
				continue;
			}
			b.image(rel.target, async () => zip.file(rel.target)?.async('nodebuffer'), { paragraph });
		}
		for (const rid of ctx.pendingCharts.splice(0)) {
			const rel = docRels.get(rid);
			if (rel && !rel.external) charts.push({ target: rel.target, paragraph });
		}
	};

	const walk = (nodes: XNode[]) => {
		for (const n of nodes) {
			switch (tagOf(n)) {
				case 'p': {
					const pPr = child(n, 'pPr');
					const { style, heading } = headingOf(attr(child(pPr, 'pStyle'), 'val'), pPr, ctx);
					const numPr = child(pPr, 'numPr');
					const loc: Record<string, string | number> = {};
					if (style) loc.style = style;
					if (heading) loc.heading = heading;
					if (numPr) loc.list_level = int(attr(child(numPr, 'ilvl'), 'val'), 0) + 1;
					const pn = b.paragraph(inlineText(kids(n), ctx), loc);
					flush(pn);
					break;
				}
				case 'tbl': {
					const t = readTable(n, ctx);
					if (t.nRows > 0) b.table(t.cells, t.nRows, t.nCols, '');
					flush(b.currentParagraph);
					break;
				}
				case 'sdt':
					walk(kids(child(n, 'sdtContent')));
					break;
				case 'customXml':
					walk(kids(n));
					break;
				case 'ins':
				case 'moveTo':
					ctx.tracked += 1;
					walk(kids(n));
					break;
				case 'del':
				case 'moveFrom':
					ctx.tracked += 1;
					break;
				case 'AlternateContent':
					walk(choiceOf(n));
					break;
				case 'altChunk':
					throw altChunk();
				default:
					break;
			}
		}
	};
	walk(kids(body));

	// headers / footers (one block per part)
	let partImages = 0;
	const byName = (a: { target: string }, c: { target: string }) => a.target.localeCompare(c.target, 'en', { numeric: true });
	for (const [type, prefix, label] of [
		['header', 'hdr', 'header'],
		['footer', 'ftr', 'footer']
	] as const) {
		for (const rel of relOf(type).sort(byName)) {
			const f = zip.file(rel.target);
			if (!f) throw failed(`Word ${label === 'header' ? '머리글' : '바닥글'} 파트(${rel.target})가 없음 (손상)`);
			const root = rootOf(parseOrdered(await f.async('string')), type === 'header' ? 'hdr' : 'ftr');
			const parts = [blocksText(kids(root), ctx, false)];
			while (ctx.pendingTextboxes.length) parts.push(blocksText(ctx.pendingTextboxes.shift()!, ctx, false));
			partImages += ctx.pendingImages.splice(0).length;
			ctx.pendingCharts.splice(0);
			b.part(prefix, parts.filter((p) => p.trim()).join('\n'), { part: label, source: path.posix.basename(rel.target) });
		}
	}
	if (partImages) b.warn(`머리글/바닥글 안 이미지 ${partImages}개는 OCR하지 않음`);

	// footnotes / endnotes
	for (const [type, item, prefix, label] of [
		['footnotes', 'footnote', 'fn', 'footnote'],
		['endnotes', 'endnote', 'en', 'endnote']
	] as const) {
		const rel = relOf(type)[0];
		if (!rel) continue;
		const f = zip.file(rel.target);
		if (!f) throw failed(`Word ${label === 'footnote' ? '각주' : '미주'} 파트가 없음 (손상)`);
		const root = rootOf(parseOrdered(await f.async('string')), type);
		for (const note of children(root, item)) {
			const kind = attr(note, 'type');
			if (kind && kind !== 'normal') continue; // separators
			const parts = [blocksText(kids(note), ctx, false)];
			while (ctx.pendingTextboxes.length) parts.push(blocksText(ctx.pendingTextboxes.shift()!, ctx, false));
			ctx.pendingImages.splice(0);
			ctx.pendingCharts.splice(0);
			b.part(prefix, parts.filter((p) => p.trim()).join('\n').trim(), { part: label, [label]: int(attr(note, 'id'), 0) });
		}
	}

	// charts (cached values)
	for (const c of charts) {
		const cx = await zip.file(c.target)?.async('string');
		if (!cx) {
			b.warn(`차트 파트(${c.target})를 찾을 수 없음`);
			continue;
		}
		const { title, text } = chartXmlToText(cx);
		const base = path.posix.basename(c.target, '.xml');
		b.block({
			evidence_id: `f${fi}.d.${base.replace(/\W/g, '_')}`,
			kind: 'chart',
			location: { paragraph: c.paragraph, chart: path.posix.basename(c.target), title: title || null },
			text,
			ocr_confidence: null
		});
	}

	const comments = relOf('comments')[0];
	if (comments) {
		const f = zip.file(comments.target);
		const n = f ? children(rootOf(parseOrdered(await f.async('string')), 'comments'), 'comment').length : 0;
		if (n) b.warn(`메모(댓글) ${n}개는 분석에서 제외함`);
	}
	if (ctx.tracked) b.warn(`변경 내용 추적 표시 ${ctx.tracked}건: 삽입은 반영하고 삭제는 제외한 "모두 수락" 상태로 분석함`);
	if (ctx.hidden) b.warn(`숨김 서식 텍스트 ${ctx.hidden}개 구간이 포함됨 (Word 화면에는 보이지 않을 수 있음)`);
	if (ctx.nested) b.warn(`중첩 표 ${ctx.nested}개는 바깥 표 셀의 텍스트로 평탄화함`);
	if (ctx.math) b.warn(`수식 ${ctx.math}개는 텍스트로 옮기지 않음 (분석 제외)`);
	if (ctx.symbols) b.warn(`기호 글꼴 문자 ${ctx.symbols}개는 텍스트로 옮기지 않음`);
	if (ctx.objects) b.warn(`포함된 OLE 개체 ${ctx.objects}개는 분석하지 않음`);
	if (externalImages) b.warn(`외부 링크 이미지 ${externalImages}개는 가져오지 않음`);
	if (Object.keys(zip.files).some((n) => /vbaProject\.bin$/i.test(n))) b.warn('매크로가 포함된 문서 — 매크로는 실행하지 않음');

	return b.finish(await toolAvailable('tesseract'), input.ocrBudget, input.maxOcrPages);
}
