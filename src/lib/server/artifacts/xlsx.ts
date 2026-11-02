import ExcelJS from 'exceljs';
import type { ArtifactInput, ResultCell } from './generate';
import { VERSION_NOTE, XmlSanitizer, effectiveTable, fail } from './common';

export const SHEET_RESULT = '결과';
export const SHEET_SUMMARY = '요약';
export const SHEET_VERSIONS = '버전·근거';
const EXCEL_MAX_TEXT = 32767;

type XValue = string | number | boolean | Date | null;

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Canonical decimal text, so "1.50" and 1.5 compare equal, but "007" or 20-digit integers do not. */
function canonicalDecimal(v: string): string {
	let s = v;
	if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
	if (s === '-0') s = '0';
	return s;
}

/** Number only when the decimal text survives a double round trip exactly. */
export function exactNumber(v: string): number | null {
	if (!DECIMAL.test(v)) return null;
	const n = Number(v);
	if (!Number.isFinite(n)) return null;
	const back = Object.is(n, -0) ? '0' : String(n);
	return back === canonicalDecimal(v) ? n : null;
}

function isoDate(v: string): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
	if (!m) return null;
	const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
	return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]! ? d : null;
}

export function xlsxValue(c: ResultCell | undefined, san: XmlSanitizer): XValue {
	if (!c || c.type === 'empty') return null;
	const raw = c.value ?? c.display;
	if (raw === null) return null;
	if (c.type === 'number' && c.value !== null) {
		const n = exactNumber(c.value);
		if (n !== null) return n;
	}
	if (c.type === 'date' && c.value !== null) {
		const d = isoDate(c.value);
		if (d) return d;
	}
	if (c.type === 'boolean' && (c.value === 'true' || c.value === 'false')) return c.value === 'true';
	// error / formula_uncomputed / string / unrepresentable values stay text — never a formula.
	const text = c.type === 'error' || c.type === 'formula_uncomputed' ? (c.display ?? c.value ?? '') : raw;
	return san.clean(text);
}

function textLen(v: XValue): number {
	if (v === null) return 0;
	if (v instanceof Date) return 10;
	return String(v).length;
}

interface Plan {
	sheet: string;
	rows: XValue[][];
}

export async function buildXlsx(input: ArtifactInput): Promise<{
	bytes: Buffer;
	plans: Plan[];
	rowCount: number;
	san: XmlSanitizer;
}> {
	const san = new XmlSanitizer();
	const table = effectiveTable(input);
	const result: XValue[][] = [table.columns.map((c) => san.clean(c.label))];
	for (const row of table.rows) result.push(table.columns.map((c) => xlsxValue(row.cells[c.column_id], san)));

	const summary: XValue[][] = [
		['제목', san.clean(input.title)],
		['요약', san.clean(input.summary)],
		...input.warnings.map((w, i) => [i === 0 ? '경고' : null, san.clean(w)] as XValue[]),
		[null, null],
		['claim_key', 'value', 'type', 'unit'],
		...input.claims.map((c) => [san.clean(c.claim_key), san.clean(c.value), san.clean(c.type), c.unit === null ? null : san.clean(c.unit)])
	];
	const versions: XValue[][] = [
		[VERSION_NOTE],
		['파일명', 'sha256', 'provider_revision', 'captured_at'],
		...input.versionInfo.map((v) => [san.clean(v.name), v.sha256, v.provider_revision, v.captured_at] as XValue[]),
		[null],
		[`'${SHEET_RESULT}' 시트 행`, 'record_id'],
		...table.rows.map((r, i) => [i + 2, san.clean(r.record_id)] as XValue[])
	];
	const blankToNull = (rows: XValue[][]) => rows.map((r) => r.map((v) => (v === '' ? null : v)));
	const plans: Plan[] = [
		{ sheet: SHEET_RESULT, rows: blankToNull(result) },
		{ sheet: SHEET_SUMMARY, rows: blankToNull(summary) },
		{ sheet: SHEET_VERSIONS, rows: blankToNull(versions) }
	];

	const wb = new ExcelJS.Workbook();
	wb.creator = 'yeeun';
	wb.created = new Date(0);
	for (const plan of plans) {
		const ws = wb.addWorksheet(plan.sheet);
		plan.rows.forEach((vals, ri) => {
			vals.forEach((v, ci) => {
				if (v === null) return;
				if (typeof v === 'string' && v.length > EXCEL_MAX_TEXT) {
					fail(`${plan.sheet} 시트 ${ri + 1}행 ${ci + 1}열: 텍스트가 Excel 셀 한도(${EXCEL_MAX_TEXT}자)를 넘어 xlsx로 만들 수 없습니다`);
				}
				const cell = ws.getCell(ri + 1, ci + 1);
				cell.value = v;
				if (v instanceof Date) cell.numFmt = 'yyyy-mm-dd';
				else if (typeof v === 'string') cell.numFmt = '@';
				if (typeof v === 'string' && v.includes('\n')) cell.alignment = { wrapText: true, vertical: 'top' };
			});
		});
		const width = Math.max(0, ...plan.rows.map((r) => r.length));
		for (let ci = 1; ci <= width; ci++) {
			const len = Math.max(4, ...plan.rows.map((r) => textLen(r[ci - 1] ?? null)));
			ws.getColumn(ci).width = Math.min(60, len + 2);
		}
		if (plan.sheet === SHEET_RESULT) {
			ws.getRow(1).font = { bold: true };
			ws.views = [{ state: 'frozen', ySplit: 1 }];
		}
	}
	const bytes = Buffer.from(await wb.xlsx.writeBuffer());
	return { bytes, plans, rowCount: table.rows.length, san };
}

function same(actual: unknown, expected: XValue): boolean {
	if (expected === null) return actual === null || actual === undefined || actual === '';
	if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
	return actual === expected;
}

export async function validateXlsx(bytes: Buffer, plans: Plan[]): Promise<string[]> {
	const wb = new ExcelJS.Workbook();
	try {
		await wb.xlsx.load(bytes as unknown as ArrayBuffer);
	} catch (e) {
		fail(`생성한 xlsx를 다시 열 수 없음: ${(e as Error).message.slice(0, 120)}`);
	}
	let cells = 0;
	for (const plan of plans) {
		const ws = wb.getWorksheet(plan.sheet);
		if (!ws) fail(`xlsx에 '${plan.sheet}' 시트가 없음`);
		plan.rows.forEach((vals, ri) => {
			vals.forEach((exp, ci) => {
				const cell = ws.getCell(ri + 1, ci + 1);
				if (
					cell.type === ExcelJS.ValueType.Formula ||
					(cell.value !== null && typeof cell.value === 'object' && !(cell.value instanceof Date))
				) {
					fail(`${plan.sheet}!R${ri + 1}C${ci + 1}: 값이 아닌 수식/복합 객체로 저장됨`);
				}
				if (!same(cell.value, exp)) fail(`${plan.sheet}!R${ri + 1}C${ci + 1}: 다시 연 값이 원래 값과 다름`);
				cells++;
			});
		});
		if (ws.actualRowCount > plan.rows.filter((r) => r.some((v) => v !== null)).length) {
			fail(`${plan.sheet} 시트에 예상하지 않은 행이 있음`);
		}
	}
	const header = plans[0]!.rows[0]!;
	return [
		`xlsx 다시 열기: 시트 ${plans.map((p) => p.sheet).join(', ')}`,
		`'${SHEET_RESULT}' 헤더 ${header.length}개 순서·라벨 일치, 데이터 ${plans[0]!.rows.length - 1}행`,
		`셀 ${cells}개 값·형식 일치, 수식 셀 없음`
	];
}
