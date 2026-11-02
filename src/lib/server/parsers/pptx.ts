import JSZip from 'jszip';
import path from 'node:path';
import type { Table, TextBlock } from '../../shared/manifest';
import { AppError } from '../errors';
import { colLetter, typedFromText, type ParseInput, type ParseOutput } from './types';
import { ocrImage } from './ocr';
import { toolAvailable } from './exec';
import { chartXmlToText, ooxmlParser as parser, partRels as rels } from './xlsx';

function arr<T>(v: T | T[] | undefined): T[] {
	return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
}

/**
 * Normalise DrawingML so run order survives object-style parsing: line breaks
 * become newline runs and fields (slide number, date) become ordinary runs.
 */
function normaliseRuns(xml: string): string {
	return xml
		.replace(/<a:br\b[^>]*\/>/g, '<a:r><a:t>\n</a:t></a:r>')
		.replace(/<a:br\b[^>]*>[\s\S]*?<\/a:br>/g, '<a:r><a:t>\n</a:t></a:r>')
		.replace(/<a:fld\b/g, '<a:r')
		.replace(/<\/a:fld>/g, '</a:r>');
}

function leaf(v: unknown): string {
	if (v === null || v === undefined) return '';
	if (typeof v === 'object') return String((v as Record<string, unknown>)['#text'] ?? '');
	return String(v);
}

function paragraphText(p: unknown): string {
	return arr((p as Record<string, unknown>).r as unknown[])
		.map((r) => leaf((r as Record<string, unknown>).t))
		.join('');
}

/** Paragraph texts in document order; tables are skipped (they become slide_table). */
function paragraphs(node: unknown, out: string[] = []): string[] {
	if (node === null || typeof node !== 'object') return out;
	if (Array.isArray(node)) {
		node.forEach((n) => paragraphs(n, out));
		return out;
	}
	for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
		if (k.startsWith('@') || k === '#text') continue;
		if (k === 'tbl') continue;
		if (k === 'p') {
			for (const p of arr(v as unknown[])) out.push(paragraphText(p));
		} else paragraphs(v, out);
	}
	return out;
}

function joinParas(ps: string[]): string {
	return ps
		.join('\n')
		.split('\n')
		.map((l) => l.replace(/[ \t]+$/g, ''))
		.filter((l) => l.trim())
		.join('\n');
}

function findAll(node: unknown, key: string, out: unknown[] = []): unknown[] {
	if (node === null || typeof node !== 'object') return out;
	if (Array.isArray(node)) {
		node.forEach((n) => findAll(n, key, out));
		return out;
	}
	for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
		if (k === key) out.push(...arr(v));
		else findAll(v, key, out);
	}
	return out;
}

/** Speaker notes = text of the notes body placeholder only (not slide number/header placeholders). */
function notesText(nx: unknown): string {
	const bodies = findAll(nx, 'sp').filter((sp) => {
		const ph = (sp as Record<string, any>)?.nvSpPr?.nvPr?.ph;
		return ph && ph['@type'] === 'body';
	});
	return joinParas(bodies.flatMap((b) => paragraphs((b as Record<string, unknown>).txBody)));
}

export async function parsePptx(input: ParseInput): Promise<ParseOutput> {
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(input.bytes);
	} catch {
		throw new AppError('PARSE_FAILED', 'PowerPoint 파일을 열 수 없음 (손상 또는 암호화)', 'preparing');
	}
	const pres = zip.file('ppt/presentation.xml');
	if (!pres) throw new AppError('PARSE_FAILED', 'presentation.xml 없음', 'preparing');
	const presXml = parser.parse(await pres.async('string'));
	const presRels = await rels(zip, 'ppt/presentation.xml');
	const slideIds = arr(presXml?.presentation?.sldIdLst?.sldId) as Record<string, string>[];
	const fi = input.fileIndex;
	const out: TextBlock[] = [];
	const tables: Table[] = [];
	const warnings: string[] = [];
	const ocrOk = await toolAvailable('tesseract');
	let s = 0;
	for (const sid of slideIds) {
		s += 1;
		const rel = presRels.get(sid['@id'] ?? sid['@r:id'] ?? '');
		const xmlText = rel ? await zip.file(rel.target)?.async('string') : undefined;
		if (!rel || !xmlText) {
			throw new AppError('PARSE_FAILED', `슬라이드 ${s} 파트를 찾을 수 없음 (손상된 PowerPoint)`, 'preparing');
		}
		const xml = parser.parse(normaliseRuns(xmlText));
		const hidden = xml?.sld?.['@show'] === '0' || xml?.sld?.['@show'] === 'false';
		if (hidden && !input.selector.include_hidden_slides) {
			warnings.push(`숨김 슬라이드 ${s} 제외 (작업 계획 설정)`);
			continue;
		}
		out.push({
			evidence_id: `f${fi}.sl${s}`,
			kind: 'slide',
			location: { slide: s, hidden },
			text: joinParas(paragraphs(xml?.sld?.cSld)),
			ocr_confidence: null
		});
		// tables
		findAll(xml?.sld?.cSld, 'tbl').forEach((tbl, ti) => {
			const trs = arr((tbl as Record<string, unknown>).tr as unknown[]);
			const grid = trs.map((tr) =>
				arr((tr as Record<string, unknown>).tc as unknown[]).map((tc) => joinParas(paragraphs((tc as Record<string, unknown>).txBody)))
			);
			const header = grid[0] ?? [];
			const columns = header.map((h, i) => ({ column_id: colLetter(i + 1), label: h.trim() || colLetter(i + 1), index: i + 1 }));
			tables.push({
				table_id: `f${fi}.sl${s}.t${ti}`,
				kind: 'slide_table',
				label: `슬라이드 ${s} 표 ${ti + 1}`,
				header_row: 1,
				columns,
				merged_ranges: [],
				rows: grid.slice(1).map((cells, ri) => ({
					record_id: `f${fi}.sl${s}.t${ti}.r${ri + 2}`,
					row_number: ri + 2,
					hidden: false,
					evidence_id: `f${fi}.sl${s}.t${ti}.r${ri + 2}`,
					cells: columns.map((c, ci) => typedFromText(cells[ci] ?? '', c.column_id, `f${fi}.sl${s}.t${ti}!${c.column_id}${ri + 2}`))
				}))
			});
		});
		const slideRels = await rels(zip, rel.target);
		const seen = new Set<string>();
		for (const [, r] of slideRels) {
			if (r.external || seen.has(r.target)) continue;
			seen.add(r.target);
			if (r.type.endsWith('/chart')) {
				const cx = await zip.file(r.target)?.async('string');
				if (!cx) {
					warnings.push(`슬라이드 ${s} 차트 파트(${r.target})를 찾을 수 없음`);
					continue;
				}
				const { title, text } = chartXmlToText(cx);
				out.push({
					evidence_id: `f${fi}.sl${s}.${path.posix.basename(r.target, '.xml')}`,
					kind: 'chart',
					location: { slide: s, chart: path.posix.basename(r.target), title: title || null },
					text: text.slice(0, 20000),
					ocr_confidence: null
				});
			}
			if (r.type.endsWith('/notesSlide') && input.selector.include_notes) {
				const nx = parser.parse(normaliseRuns((await zip.file(r.target)?.async('string')) ?? ''));
				const nt = notesText(nx);
				if (nt) out.push({ evidence_id: `f${fi}.sl${s}.notes`, kind: 'notes', location: { slide: s }, text: nt, ocr_confidence: null });
			}
			if (r.type.endsWith('/image') && /\.(png|jpe?g)$/i.test(r.target)) {
				if (!ocrOk) {
					warnings.push(`슬라이드 ${s} 이미지 텍스트는 OCR 도구가 없어 읽지 않음`);
					continue;
				}
				const img = await zip.file(r.target)?.async('nodebuffer');
				if (!img) continue;
				const res = await ocrImage(img, fi, input.ocrBudget, input.maxOcrPages);
				out.push(
					...res.texts.map((t) => ({
						...t,
						evidence_id: t.evidence_id.replace(`f${fi}.img`, `f${fi}.sl${s}.${path.posix.basename(r.target).replace(/\W/g, '_')}`),
						location: { ...t.location, slide: s, image: path.posix.basename(r.target) }
					}))
				);
				warnings.push(...res.warnings.map((w) => `슬라이드 ${s} 이미지: ${w}`));
			}
		}
	}
	return { tables, texts: out, warnings };
}
