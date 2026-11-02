import { parse } from 'csv-parse/sync';
import iconv from 'iconv-lite';
import type { ArtifactInput } from './generate';
import { cellText, effectiveTable, fail } from './common';

const PLAIN_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const DANGEROUS_START = /^[=+\-@\t\r]/;

/**
 * Spreadsheet formula-injection defence (OWASP CSV injection): text starting with
 * = + - @ TAB CR gets a leading apostrophe. Plain numbers such as -12.5 are left alone.
 */
export function escapeFormula(s: string): { text: string; escaped: boolean } {
	if (DANGEROUS_START.test(s) && !PLAIN_NUMBER.test(s)) return { text: `'${s}`, escaped: true };
	return { text: s, escaped: false };
}

function quote(field: string, delimiter: string): string {
	if (field.includes(delimiter) || /["\r\n]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
	return field;
}

export interface DelimitedResult {
	bytes: Buffer;
	records: string[][];
	escaped: number;
	rowCount: number;
}

export function buildDelimited(input: ArtifactInput, delimiter: ',' | '\t'): DelimitedResult {
	const table = effectiveTable(input);
	let escaped = 0;
	const esc = (s: string) => {
		const r = escapeFormula(s);
		if (r.escaped) escaped++;
		return r.text;
	};
	const records: string[][] = [table.columns.map((c) => esc(c.label))];
	for (const row of table.rows) records.push(table.columns.map((c) => esc(cellText(row.cells[c.column_id]))));
	// RFC 4180: CRLF record separator, quoted fields keep embedded newlines verbatim.
	// A lone empty field is written as "" so the line is not mistaken for a blank line.
	const line = (r: string[]) => (r.length === 1 && r[0] === '' ? '""' : r.map((f) => quote(f, delimiter)).join(delimiter));
	const text = records.length && records[0]!.length ? records.map(line).join('\r\n') + '\r\n' : '';

	let bytes: Buffer;
	if (input.csvEncoding === 'cp949') {
		bytes = iconv.encode(text, 'cp949');
		if (iconv.decode(bytes, 'cp949') !== text) {
			const bad = [...text].find((ch) => iconv.decode(iconv.encode(ch, 'cp949'), 'cp949') !== ch) ?? '?';
			fail(
				`CP949로 표현할 수 없는 문자(U+${bad.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})가 있어 CP949 파일을 만들 수 없습니다. UTF-8을 선택하세요.`
			);
		}
	} else {
		const body = Buffer.from(text, 'utf-8');
		bytes = input.csvEncoding === 'utf-8-bom' ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
	}
	return { bytes, records, escaped, rowCount: table.rows.length };
}

/** Decode + parse the produced bytes and compare them to what was intended. */
export function validateDelimited(
	bytes: Buffer,
	expected: string[][],
	delimiter: ',' | '\t',
	encoding: ArtifactInput['csvEncoding']
): string[] {
	const checks: string[] = [];
	let text: string;
	const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
	if (encoding === 'cp949') {
		text = iconv.decode(bytes, 'cp949');
	} else {
		if (encoding === 'utf-8-bom' && !hasBom) fail('UTF-8 BOM이 없음');
		if (encoding === 'utf-8' && hasBom) fail('BOM 없는 UTF-8이어야 하는데 BOM이 있음');
		try {
			text = new TextDecoder('utf-8', { fatal: true }).decode(hasBom ? bytes.subarray(3) : bytes);
		} catch {
			fail('UTF-8로 다시 읽을 수 없음');
		}
	}
	checks.push(`${encoding} 디코딩 확인`);
	let parsed: string[][];
	try {
		parsed = parse(text, {
			delimiter,
			relax_column_count: false,
			skip_empty_lines: false,
			bom: false,
			trim: false
		}) as string[][];
	} catch (e) {
		fail(`생성한 ${delimiter === ',' ? 'CSV' : 'TSV'}를 다시 파싱할 수 없음: ${(e as Error).message.slice(0, 120)}`);
	}
	// A header-only file with zero columns parses to nothing; normalise for comparison.
	const exp = expected.length === 1 && expected[0]!.length === 0 ? [] : expected;
	if (parsed.length !== exp.length) fail(`레코드 수 불일치: ${parsed.length} ≠ ${exp.length}`);
	for (let i = 0; i < exp.length; i++) {
		const a = parsed[i]!;
		const b = exp[i]!;
		if (a.length !== b.length || a.some((v, j) => v !== b[j])) fail(`${i + 1}번째 레코드 값 불일치`);
	}
	checks.push(`다시 파싱: 헤더 1행 + 데이터 ${exp.length - 1 < 0 ? 0 : exp.length - 1}행, 모든 셀 값 일치`);
	return checks;
}
