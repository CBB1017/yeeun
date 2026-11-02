import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { Cell, Table, TextBlock } from '../../shared/manifest';
import { AppError } from '../errors';
import { parseStrictDate, pad } from '../checks/dates';
import { colLetter, typedFromText, type ParseInput, type ParseOutput } from './types';

function utcDate(d: Date): string {
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function hasTime(d: Date): boolean {
	return d.getUTCHours() + d.getUTCMinutes() + d.getUTCSeconds() + d.getUTCMilliseconds() > 0;
}

const DAY_MS = 86_400_000;
const MAR_1_1900 = Date.UTC(1900, 2, 1);
const FEB_28_1900 = Date.UTC(1900, 1, 28);
const JAN_1_1900 = Date.UTC(1900, 0, 1);

interface CellCtx {
	date1904: boolean;
	/** Correction when the workbook declares 1904 in a form ExcelJS ignores (date1904="true"). */
	shiftMs: number;
	/** Problems found while typing cells (reported as warnings, never silently fixed). */
	notes: string[];
}

/**
 * ExcelJS converts serials with a 1899-12-30 epoch, which is only right from
 * 1900-03-01 on in the 1900 system (Excel's fictitious 1900-02-29 is serial 60).
 * Returns the real calendar instant, or null for serials Excel shows as
 * non-dates (1900-02-29, 1900-01-00, negatives).
 */
function excel1900Fix(d: Date): Date | null {
	const t = d.getTime();
	if (t >= MAR_1_1900) return d;
	const dayStart = Math.floor(t / DAY_MS) * DAY_MS;
	if (dayStart === FEB_28_1900) return null; // serial 60 -> 1900-02-29 (does not exist)
	const fixed = new Date(t + DAY_MS);
	return fixed.getTime() < JAN_1_1900 ? null : fixed;
}

function scalarCell(v: unknown, text: string, colId: string, evId: string, formula: string | null, ctx: CellCtx): Cell {
	const base = { column_id: colId, evidence_id: evId, formula };
	if (v === null || v === undefined || v === '') {
		return formula
			? { ...base, type: 'formula_uncomputed', value: null, display: null }
			: { ...base, type: 'empty', value: null, display: '' };
	}
	if (typeof v === 'number') return { ...base, type: 'number', value: String(v), display: text || String(v) };
	if (typeof v === 'boolean') return { ...base, type: 'boolean', value: String(v), display: text };
	if (v instanceof Date) {
		if (Number.isNaN(v.getTime())) return { ...base, type: 'error', value: null, display: text };
		const src = ctx.shiftMs ? new Date(v.getTime() + ctx.shiftMs) : v;
		const d = ctx.date1904 ? src : excel1900Fix(src);
		if (!d) {
			const shown = Math.floor(v.getTime() / DAY_MS) * DAY_MS === FEB_28_1900 ? '1900-02-29' : '1900-01-00';
			ctx.notes.push(`${evId}: Excel 날짜 일련번호가 실제 달력에 없는 날짜(${shown})를 가리킴 — 보정하지 않고 오류로 표시`);
			return { ...base, type: 'error', value: null, display: shown };
		}
		return {
			...base,
			type: 'date',
			value: hasTime(d) ? d.toISOString() : utcDate(d),
			display: d === v && text ? text : hasTime(d) ? d.toISOString() : utcDate(d)
		};
	}
	if (typeof v === 'string') {
		const t = typedFromText(v, colId, evId);
		return { ...t, formula };
	}
	if (typeof v === 'object' && v && 'error' in v) {
		return { ...base, type: 'error', value: String((v as { error: string }).error), display: text };
	}
	return { ...base, type: 'string', value: text, display: text };
}

function toCell(cell: ExcelJS.Cell, colId: string, evId: string, ctx: CellCtx): Cell {
	const v = cell.value as unknown;
	let text = '';
	try {
		text = cell.text ?? '';
	} catch {
		text = '';
	}
	if (v && typeof v === 'object' && !(v instanceof Date)) {
		const o = v as Record<string, unknown>;
		if ('formula' in o || 'sharedFormula' in o) {
			const formula = String(o.formula ?? o.sharedFormula ?? '');
			return scalarCell(o.result, text, colId, evId, formula, ctx);
		}
		if ('richText' in o) return scalarCell((o.richText as { text: string }[]).map((r) => r.text).join(''), text, colId, evId, null, ctx);
		if ('hyperlink' in o) return scalarCell(String(o.text ?? ''), text, colId, evId, null, ctx);
	}
	return scalarCell(v, text, colId, evId, null, ctx);
}

/**
 * Values are kept as literal text: numeric-looking strings ("001", "1.50") must
 * not be converted, and whitespace inside runs is significant.
 */
export const ooxmlParser = new XMLParser({
	ignoreAttributes: false,
	removeNSPrefix: true,
	attributeNamePrefix: '@',
	parseTagValue: false,
	parseAttributeValue: false,
	trimValues: false
});

function arr<T>(v: T | T[] | undefined): T[] {
	return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
}

function leaf(v: unknown): string {
	if (v === null || v === undefined) return '';
	if (typeof v === 'object') return String((v as Record<string, unknown>)['#text'] ?? '');
	return String(v);
}

/** Text of a DrawingML rich-text body: runs joined per paragraph, paragraphs by newline. */
function richText(rich: unknown): string {
	return arr((rich as Record<string, unknown> | undefined)?.p as unknown[])
		.map((p) => {
			const pp = p as Record<string, unknown>;
			return [...arr(pp.r as unknown[]), ...arr(pp.fld as unknown[])].map((r) => leaf((r as Record<string, unknown>).t)).join('');
		})
		.join('\n')
		.trim();
}

/** Cached points by idx (so gaps stay aligned with categories). */
function points(cache: unknown): Map<number, string> {
	const m = new Map<number, string>();
	for (const pt of arr((cache as Record<string, unknown> | undefined)?.pt as unknown[])) {
		const p = pt as Record<string, unknown>;
		m.set(Number(p['@idx'] ?? m.size), leaf(p.v));
	}
	return m;
}

/** Category labels, including multi-level categories (outer levels joined after the leaf: "Q1 / 2026"). */
function categoryPoints(cat: Record<string, any> | undefined): Map<number, string> {
	if (!cat) return new Map();
	const multi = cat.multiLvlStrRef?.multiLvlStrCache;
	if (multi) {
		const levels = arr(multi.lvl as unknown[]).map(points);
		const out = new Map<number, string>();
		for (const [i, v] of levels[0] ?? new Map<number, string>()) {
			const outer = levels
				.slice(1)
				.map((l) => {
					// outer levels label the first index of their group
					const keys = [...l.keys()].filter((k) => k <= i).sort((a, b) => b - a);
					return keys.length ? l.get(keys[0]!) : undefined;
				})
				.filter((x): x is string => Boolean(x));
			out.set(i, [v, ...outer].join(' / '));
		}
		return out;
	}
	return points(cat.strRef?.strCache ?? cat.numRef?.numCache ?? cat.strLit ?? cat.numLit);
}

function txText(tx: unknown): string {
	const t = tx as Record<string, any> | undefined;
	if (!t) return '';
	if (t.rich) return richText(t.rich);
	if (t.strRef) return [...points(t.strRef.strCache).values()].join(' ');
	if (t.v !== undefined) return leaf(t.v);
	return '';
}

/** Series/labels/cached values/number formats from one chart part (no rendering, no recalculation). */
export function chartXmlToText(xmlText: string): { title: string; text: string } {
	const xml = ooxmlParser.parse(xmlText);
	const chart = xml?.chartSpace?.chart ?? {};
	const plot = chart.plotArea ?? {};
	const title = txText(chart.title?.tx);
	const lines: string[] = [];
	for (const [kind, bodies] of Object.entries(plot)) {
		if (!/Chart$/.test(kind)) continue;
		for (const body of arr(bodies as unknown[])) {
			for (const ser of arr((body as Record<string, unknown>).ser as unknown[])) {
				const s = ser as Record<string, any>;
				const name = txText(s.tx);
				const catNode = s.cat ?? s.xVal;
				const cats = categoryPoints(catNode);
				const valNode = s.val ?? s.yVal;
				const cache = valNode?.numRef?.numCache ?? valNode?.numLit;
				const vals = points(cache);
				const fmt = cache?.formatCode !== undefined ? leaf(cache.formatCode) : null;
				const idxs = [...vals.keys()].sort((a, b) => a - b);
				lines.push(
					`${kind} series "${name}" [format ${fmt ?? 'n/a'}]: ` + idxs.map((i) => `${cats.get(i) ?? i + 1}=${vals.get(i)}`).join(', ')
				);
			}
		}
	}
	for (const [kind, axes] of Object.entries(plot)) {
		if (!/Ax$/.test(kind)) continue;
		for (const ax of arr(axes as unknown[])) {
			const a = ax as Record<string, any>;
			const at = txText(a.title?.tx);
			const fmt = a.numFmt?.['@formatCode'];
			if (at || fmt) lines.push(`axis ${kind}${at ? ` title "${at}"` : ''}${fmt ? ` [format ${fmt}]` : ''}`);
		}
	}
	return { title, text: [title ? `title: ${title}` : '', ...lines].filter(Boolean).join('\n') };
}

/** Relationship targets of an OOXML part, resolved to zip paths. */
export async function partRels(zip: JSZip, file: string): Promise<Map<string, { target: string; type: string; external: boolean }>> {
	const relPath = path.posix.join(path.posix.dirname(file), '_rels', path.posix.basename(file) + '.rels');
	const f = zip.file(relPath);
	const map = new Map<string, { target: string; type: string; external: boolean }>();
	if (!f) return map;
	const x = ooxmlParser.parse(await f.async('string'));
	for (const r of arr(x?.Relationships?.Relationship as unknown[])) {
		const rr = r as Record<string, string>;
		const raw = rr['@Target'] ?? '';
		const external = rr['@TargetMode'] === 'External';
		const target = external
			? raw
			: raw.startsWith('/')
				? raw.slice(1)
				: path.posix.normalize(path.posix.join(path.posix.dirname(file), raw));
		map.set(rr['@Id']!, { target, type: rr['@Type'] ?? '', external });
	}
	return map;
}

/** chart part path -> owning sheet name (sheet/chartsheet -> drawing -> chart). */
async function chartOwners(zip: JSZip): Promise<Map<string, string>> {
	const owners = new Map<string, string>();
	const wbFile = zip.file('xl/workbook.xml');
	if (!wbFile) return owners;
	const wb = ooxmlParser.parse(await wbFile.async('string'));
	const wbRels = await partRels(zip, 'xl/workbook.xml');
	for (const sh of arr(wb?.workbook?.sheets?.sheet as unknown[])) {
		const s = sh as Record<string, string>;
		const rel = wbRels.get(s['@id'] ?? '');
		if (!rel) continue;
		for (const [, d] of await partRels(zip, rel.target)) {
			if (!d.type.endsWith('/drawing')) continue;
			for (const [, c] of await partRels(zip, d.target)) {
				if (c.type.endsWith('/chart')) owners.set(c.target, s['@name'] ?? '');
			}
		}
	}
	return owners;
}

/** Chart series/labels/units from cached chart XML (rendering is done separately for visual QA). */
async function chartTexts(zip: JSZip, fileIndex: number, sheet: string | null, warnings: string[]): Promise<TextBlock[]> {
	const owners = await chartOwners(zip);
	const out: TextBlock[] = [];
	const files = Object.keys(zip.files)
		.filter((f) => /^xl\/charts\/chart\d+\.xml$/.test(f))
		.sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
	for (const f of files) {
		const owner = owners.get(f) ?? null;
		if (sheet && owner !== sheet) {
			if (owner === null) warnings.push(`차트 ${path.posix.basename(f)}의 소속 시트를 확인할 수 없어 시트 선택 범위에서 제외`);
			continue;
		}
		const { title, text } = chartXmlToText(await zip.file(f)!.async('string'));
		out.push({
			evidence_id: `f${fileIndex}.${path.posix.basename(f, '.xml')}`,
			kind: 'chart',
			location: { chart: path.posix.basename(f), sheet: owner, title: title || null },
			text,
			ocr_confidence: null
		});
	}
	return out;
}

export async function parseXlsx(input: ParseInput): Promise<ParseOutput> {
	const wb = new ExcelJS.Workbook();
	try {
		await wb.xlsx.load(input.bytes as unknown as ArrayBuffer);
	} catch (e) {
		throw new AppError('PARSE_FAILED', `Excel 파일을 열 수 없음 (손상 또는 암호화): ${(e as Error).message.slice(0, 120)}`, 'preparing');
	}
	const warnings: string[] = [];
	const tables: Table[] = [];
	const fi = input.fileIndex;
	const zip = await JSZip.loadAsync(input.bytes).catch(() => null);
	if (!zip) throw new AppError('PARSE_FAILED', 'Excel 파일을 열 수 없음 (손상 또는 암호화)', 'preparing');
	// ExcelJS only honours date1904="1"; LibreOffice and others write "true".
	const workbookPr = ((await zip.file('xl/workbook.xml')?.async('string')) ?? '').match(/<(?:\w+:)?workbookPr\b[^>]*>/)?.[0] ?? '';
	const declared1904 = /\bdate1904\s*=\s*["'](1|true)["']/i.test(workbookPr);
	const exceljs1904 = Boolean((wb as unknown as { properties?: { date1904?: boolean } }).properties?.date1904);
	const date1904 = declared1904 || exceljs1904;
	const shiftMs = date1904 && !exceljs1904 ? 1462 * DAY_MS : 0;
	if (date1904) {
		warnings.push('1904 날짜 체계 통합문서 (날짜 값은 1904 기준으로 해석됨)');
	}
	wb.worksheets.forEach((ws, si) => {
		if (input.selector.sheet && ws.name !== input.selector.sheet) return;
		if (ws.state && ws.state !== 'visible') warnings.push(`숨김 시트 "${ws.name}" 포함됨`);
		const ctx: CellCtx = { date1904, shiftMs, notes: [] };
		const merges: string[] = ((ws as unknown as { model?: { merges?: string[] } }).model?.merges ?? []).slice();
		let headerRow = input.selector.header_row ?? 0;
		if (!headerRow) {
			for (let r = 1; r <= Math.min(ws.rowCount, 50); r++) {
				const row = ws.getRow(r);
				if (row.cellCount > 0 && row.values && (row.values as unknown[]).some((v) => v !== null && v !== undefined && v !== '')) {
					headerRow = r;
					break;
				}
			}
		}
		if (!headerRow) return;
		const header = ws.getRow(headerRow);
		const columns: Table['columns'] = [];
		const maxCol = Math.max(ws.columnCount, header.cellCount);
		for (let c = 1; c <= maxCol; c++) {
			const cell = header.getCell(c);
			const src = cell.isMerged && cell.master ? cell.master : cell;
			const label = (src.text ?? '').trim();
			if (!label && c > header.cellCount) continue;
			columns.push({ column_id: colLetter(c), label: label || colLetter(c), index: c });
		}
		const labels = columns.map((c) => c.label);
		const dup = labels.filter((l, i) => labels.indexOf(l) !== i);
		if (dup.length) warnings.push(`시트 "${ws.name}"에 중복 헤더: ${[...new Set(dup)].join(', ')}`);
		const rows: Table['rows'] = [];
		for (let r = headerRow + 1; r <= ws.rowCount; r++) {
			const row = ws.getRow(r);
			const cells: Cell[] = columns.map((col) => toCell(row.getCell(col.index), col.column_id, `f${fi}.s${si}!${col.column_id}${r}`, ctx));
			if (cells.every((c) => c.type === 'empty')) continue;
			if (cells.some((c) => c.type === 'formula_uncomputed')) {
				warnings.push(`시트 "${ws.name}" ${r}행: 계산값이 저장되지 않은 수식이 있음 (원본에서 재계산하지 않음)`);
			}
			rows.push({
				record_id: `f${fi}.s${si}.r${r}`,
				row_number: r,
				hidden: Boolean(row.hidden),
				evidence_id: `f${fi}.s${si}.r${r}`,
				cells
			});
		}
		warnings.push(...ctx.notes.map((n) => `시트 "${ws.name}" ${n}`));
		const hiddenCount = rows.filter((r) => r.hidden).length;
		if (hiddenCount) {
			warnings.push(`시트 "${ws.name}" 숨김 행 ${hiddenCount}개 ${input.selector.include_hidden_rows ? '포함' : '제외'} (작업 계획 설정)`);
		}
		tables.push({
			table_id: `f${fi}.s${si}`,
			kind: 'sheet',
			label: ws.name,
			header_row: headerRow,
			columns,
			rows,
			merged_ranges: merges
		});
	});
	if (input.selector.sheet && tables.length === 0) {
		throw new AppError('INPUT_REQUIRED', `시트 "${input.selector.sheet}"를 찾을 수 없음`, 'preparing');
	}
	const texts = await chartTexts(zip, fi, input.selector.sheet, warnings).catch(() => {
		warnings.push('차트 정보를 읽지 못함');
		return [] as TextBlock[];
	});
	return { tables, texts, warnings };
}

export { parseStrictDate };
