import JSZip from 'jszip';
import path from 'node:path';
import { AppError } from '../errors';
import { toolAvailable } from './exec';
import { attr, child, children, DocBuilder, findAllX, gridProblem, kids, layoutRows, parseOrdered, tagOf, textOf, type GridCell, type XNode } from './docmodel';
import type { ParseInput, ParseOutput } from './types';

/**
 * HWPX (OWPML, KS X 6101) parser: Contents/section*.xml in spine order.
 * Paragraph text from hp:p/hp:run/hp:t, tables from hp:tbl (cellAddr/cellSpan),
 * embedded BinData images OCR'd like pptx. Encrypted packages fail.
 */

function failed(msg: string): AppError {
	return new AppError('PARSE_FAILED', msg, 'preparing');
}

interface Ctx {
	b: DocBuilder;
	zip: JSZip;
	styles: Map<string, string>;
	binItems: Map<string, string>;
	section: number;
	deleting: boolean;
	tracked: number;
	equations: number;
	objects: number;
	nested: number;
	comments: number;
	missingImages: number;
	pendingParts: { kind: 'header' | 'footer' | 'footnote' | 'endnote'; nodes: XNode[] }[];
	pendingTextboxes: XNode[][];
	pendingImages: string[];
}

function int(v: string | undefined, d: number): number {
	const n = v === undefined ? NaN : Number.parseInt(v, 10);
	return Number.isFinite(n) ? n : d;
}

/** hp:t mixed content: text plus tab/lineBreak/hyphen/space marks and track-change markers. */
function tText(t: XNode, ctx: Ctx): string {
	let s = '';
	for (const c of kids(t)) {
		const tag = tagOf(c);
		if (tag === '#text') {
			if (!ctx.deleting) s += String(c['#text'] ?? '');
			continue;
		}
		if (marker(tag, ctx) || ctx.deleting) continue;
		if (tag === 'tab') s += '\t';
		else if (tag === 'lineBreak') s += '\n';
		else if (tag === 'hyphen') s += '-';
		else if (tag === 'nbSpace' || tag === 'fwSpace') s += ' ';
	}
	return s;
}

function marker(tag: string, ctx: Ctx): boolean {
	if (tag === 'insertBegin') ctx.tracked += 1;
	else if (tag === 'deleteBegin') {
		ctx.tracked += 1;
		ctx.deleting = true;
	} else if (tag === 'deleteEnd') ctx.deleting = false;
	else return tag === 'insertEnd';
	return true;
}

/** Collect pictures and text boxes inside a drawing object / container. */
function drawing(node: XNode, ctx: Ctx): void {
	for (const img of findAllX([node], 'img')) {
		const id = attr(img, 'binaryItemIDRef');
		if (id) ctx.pendingImages.push(id);
	}
	for (const dt of findAllX([node], 'drawText')) {
		const sl = child(dt, 'subList');
		if (sl) ctx.pendingTextboxes.push(children(sl, 'p'));
	}
}

/** Visible text of one hp:p. Tables are pushed to `tables` (body) or flattened (cells, notes). */
function pText(p: XNode, ctx: Ctx, tables: XNode[] | null): string {
	let s = '';
	for (const run of kids(p)) {
		if (tagOf(run) !== 'run') continue;
		for (const c of kids(run)) {
			const tag = tagOf(c);
			if (marker(tag, ctx)) continue;
			switch (tag) {
				case 't':
					s += tText(c, ctx);
					break;
				case 'tbl':
					if (tables) tables.push(c);
					else {
						ctx.nested += 1;
						s += (s ? '\n' : '') + flatTable(c, ctx);
					}
					break;
				case 'pic':
					drawing(c, ctx);
					break;
				case 'ctrl':
					for (const k of kids(c)) {
						const kt = tagOf(k);
						const sl = child(k, 'subList');
						if (kt === 'header' || kt === 'footer') ctx.pendingParts.push({ kind: kt, nodes: children(sl, 'p') });
						else if (kt === 'footNote' || kt === 'endNote') {
							ctx.pendingParts.push({ kind: kt === 'footNote' ? 'footnote' : 'endnote', nodes: children(sl, 'p') });
						} else if (kt === 'hiddenComment') ctx.comments += 1;
					}
					break;
				case 'equation':
					ctx.equations += 1;
					break;
				case 'ole':
					ctx.objects += 1;
					break;
				case 'dutmal':
					s += textOf(child(c, 'mainText') ?? {});
					break;
				case 'compose':
					s += attr(c, 'composeText') ?? '';
					break;
				case 'rect':
				case 'ellipse':
				case 'arc':
				case 'polygon':
				case 'curve':
				case 'line':
				case 'connectLine':
				case 'container':
				case 'textart':
					drawing(c, ctx);
					break;
				default:
					break;
			}
		}
	}
	return s;
}

function parasText(ps: XNode[], ctx: Ctx): string {
	return ps.map((p) => pText(p, ctx, null)).join('\n');
}

function cellText(tc: XNode, ctx: Ctx): string {
	return parasText(children(child(tc, 'subList'), 'p'), ctx);
}

function flatTable(tbl: XNode, ctx: Ctx): string {
	return children(tbl, 'tr')
		.map((tr) =>
			children(tr, 'tc')
				.map((tc) => cellText(tc, ctx).replace(/\n/g, ' '))
				.join('\t')
		)
		.join('\n');
}

function readTable(tbl: XNode, ctx: Ctx): { cells: GridCell[]; nRows: number; nCols: number } {
	const rows = children(tbl, 'tr').map((tr) =>
		children(tr, 'tc').map((tc) => {
			const addr = child(tc, 'cellAddr');
			const span = child(tc, 'cellSpan');
			return {
				text: cellText(tc, ctx),
				col: addr ? int(attr(addr, 'colAddr'), -1) : null,
				row: addr ? int(attr(addr, 'rowAddr'), -1) : null,
				colSpan: int(attr(span, 'colSpan'), 1),
				rowSpan: int(attr(span, 'rowSpan'), 1)
			};
		})
	);
	const flat = rows.flat();
	const nRowsAttr = int(attr(tbl, 'rowCnt'), 0);
	const nColsAttr = int(attr(tbl, 'colCnt'), 0);
	if (flat.length && flat.every((c) => c.col !== null && c.row !== null)) {
		const cells = flat.map((c) => ({ text: c.text, row: c.row!, col: c.col!, rowSpan: c.rowSpan, colSpan: c.colSpan }));
		const nRows = nRowsAttr || Math.max(...cells.map((c) => c.row + c.rowSpan));
		const nCols = nColsAttr || Math.max(...cells.map((c) => c.col + c.colSpan));
		if (!gridProblem(cells, nRows, nCols)) return { cells, nRows, nCols };
	}
	const laid = layoutRows(rows);
	return { cells: laid.cells, nRows: nRowsAttr || laid.nRows, nCols: nColsAttr || laid.nCols };
}

async function readXml(zip: JSZip, name: string): Promise<XNode[]> {
	const f = zip.file(name);
	if (!f) throw failed(`한글(hwpx) 파트(${name})가 없음 (손상)`);
	const text = await f.async('string');
	if (!/^﻿?\s*</.test(text)) throw failed('한글(hwpx) 문서 내용이 XML이 아님 (암호화 또는 손상)');
	return parseOrdered(text);
}

export async function parseHwpx(input: ParseInput): Promise<ParseOutput> {
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(input.bytes);
	} catch {
		throw failed('한글(hwpx) 파일을 열 수 없음 (손상 또는 암호화)');
	}
	try {
		return await parseZip(zip, input);
	} catch (e) {
		if (e instanceof AppError) throw e;
		throw failed(`한글(hwpx) 파일 내용을 읽을 수 없음 (손상): ${(e as Error).message.slice(0, 120)}`);
	}
}

async function parseZip(zip: JSZip, input: ParseInput): Promise<ParseOutput> {
	const mimetype = (await zip.file('mimetype')?.async('string'))?.trim();
	if (mimetype !== undefined && mimetype !== 'application/hwp+zip') throw failed(`hwpx 형식이 아님 (mimetype: ${mimetype.slice(0, 60)})`);
	const manifest = await zip.file('META-INF/manifest.xml')?.async('string');
	if (manifest && /encryption-data/i.test(manifest)) throw failed('암호가 걸린 한글(hwpx) 파일 — 암호를 해제한 뒤 다시 선택하세요');

	// package: manifest items + spine order
	const binItems = new Map<string, string>();
	let sections: string[] = [];
	const hpfName = Object.keys(zip.files).find((n) => /^Contents\/content\.hpf$/i.test(n));
	let headerName: string | undefined;
	if (hpfName) {
		const pkg = findAllX(await readXml(zip, hpfName), 'package')[0];
		const items = new Map<string, string>();
		for (const it of children(child(pkg, 'manifest'), 'item')) {
			const id = attr(it, 'id');
			const href = attr(it, 'href');
			if (!id || !href) continue;
			items.set(id, href);
			if (/^BinData\//i.test(href)) binItems.set(id, href);
			if (/header\.xml$/i.test(href)) headerName = href;
		}
		sections = children(child(pkg, 'spine'), 'itemref')
			.map((r) => items.get(attr(r, 'idref') ?? '') ?? '')
			.filter((h) => /section\d+\.xml$/i.test(h));
	}
	if (!sections.length) {
		sections = Object.keys(zip.files)
			.filter((n) => /^Contents\/section\d+\.xml$/i.test(n))
			.sort((a, c) => int(/(\d+)\.xml$/i.exec(a)?.[1], 0) - int(/(\d+)\.xml$/i.exec(c)?.[1], 0));
	}
	if (!sections.length) {
		if (mimetype === undefined) throw failed('hwpx 형식이 아님 (본문 section 파트 없음)');
		throw failed('한글(hwpx) 본문 section 파트가 없음 (손상)');
	}
	for (const n of Object.keys(zip.files)) {
		if (!/^BinData\//i.test(n) || zip.files[n]!.dir) continue;
		const id = path.posix.basename(n).replace(/\.[^.]+$/, '');
		if (![...binItems.values()].includes(n) && !binItems.has(id)) binItems.set(id, n);
	}

	const styles = new Map<string, string>();
	headerName ??= zip.file('Contents/header.xml') ? 'Contents/header.xml' : undefined;
	if (headerName) {
		for (const s of findAllX(await readXml(zip, headerName), 'style')) {
			const id = attr(s, 'id');
			if (id !== undefined) styles.set(id, attr(s, 'name') ?? attr(s, 'engName') ?? id);
		}
	}

	const fi = input.fileIndex;
	const b = new DocBuilder(fi);
	const ctx: Ctx = {
		b,
		zip,
		styles,
		binItems,
		section: 0,
		deleting: false,
		tracked: 0,
		equations: 0,
		objects: 0,
		nested: 0,
		comments: 0,
		missingImages: 0,
		pendingParts: [],
		pendingTextboxes: [],
		pendingImages: []
	};
	const flush = (paragraph: number) => {
		while (ctx.pendingParts.length || ctx.pendingTextboxes.length) {
			const part = ctx.pendingParts.shift();
			if (part) {
				const prefix = { header: 'hdr', footer: 'ftr', footnote: 'fn', endnote: 'en' } as const;
				b.part(prefix[part.kind], parasText(part.nodes, ctx), { part: part.kind, section: ctx.section, paragraph });
				continue;
			}
			b.part('tb', parasText(ctx.pendingTextboxes.shift()!, ctx), { part: 'textbox', section: ctx.section, paragraph });
		}
		for (const id of ctx.pendingImages.splice(0)) {
			const href = binItems.get(id);
			if (!href || !zip.file(href)) {
				ctx.missingImages += 1;
				continue;
			}
			b.image(href, async () => zip.file(href)?.async('nodebuffer'), { section: ctx.section, paragraph });
		}
	};

	for (const [si, name] of sections.entries()) {
		ctx.section = si + 1;
		const sec = findAllX(await readXml(zip, name), 'sec')[0];
		if (!sec) throw failed(`한글(hwpx) 구역 ${si + 1}의 구조가 올바르지 않음 (손상)`);
		for (const p of children(sec, 'p')) {
			const tables: XNode[] = [];
			const styleId = attr(p, 'styleIDRef');
			const style = styleId && styleId !== '0' ? (styles.get(styleId) ?? null) : null;
			const m = style ? /^(?:개요|outline)\s*(\d+)$/i.exec(style) : null;
			const loc: Record<string, string | number> = { section: si + 1 };
			if (style) loc.style = style;
			if (m) loc.heading = Number(m[1]);
			const pn = b.paragraph(pText(p, ctx, tables), loc);
			for (const tbl of tables) {
				const cap = child(child(tbl, 'caption'), 'subList');
				if (cap) b.part('cap', parasText(children(cap, 'p'), ctx), { part: 'caption', section: si + 1, paragraph: pn });
				const t = readTable(tbl, ctx);
				b.table(t.cells, t.nRows, t.nCols, '');
			}
			flush(pn);
		}
	}

	if (ctx.tracked) b.warn(`변경 내용 추적 표시 ${ctx.tracked}건: 삽입은 반영하고 삭제는 제외한 "모두 수락" 상태로 분석함`);
	if (ctx.comments) b.warn(`숨은 설명(메모) ${ctx.comments}개는 분석에서 제외함`);
	if (ctx.nested) b.warn(`중첩 표 ${ctx.nested}개는 바깥 표 셀의 텍스트로 평탄화함`);
	if (ctx.equations) b.warn(`수식 ${ctx.equations}개는 텍스트로 옮기지 않음 (분석 제외)`);
	if (ctx.objects) b.warn(`포함된 OLE 개체 ${ctx.objects}개는 분석하지 않음`);
	if (ctx.missingImages) b.warn(`참조된 이미지 ${ctx.missingImages}개를 BinData에서 찾을 수 없음`);
	return b.finish(await toolAvailable('tesseract'), input.ocrBudget, input.maxOcrPages);
}
