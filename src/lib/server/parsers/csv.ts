import { parse } from 'csv-parse/sync';
import iconv from 'iconv-lite';
import type { Table } from '../../shared/manifest';
import { AppError } from '../errors';
import { colLetter, typedFromText, type ParseInput, type ParseOutput } from './types';

export function decodeText(bytes: Buffer, encoding: 'utf-8' | 'cp949'): { text: string; bom: boolean } {
	if (encoding === 'cp949') return { text: iconv.decode(bytes, 'cp949'), bom: false };
	const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(bom ? bytes.subarray(3) : bytes);
		return { text, bom };
	} catch {
		throw new AppError('PARSE_FAILED', 'UTF-8로 읽을 수 없는 CSV/TSV입니다. 작업 계획에서 원본 인코딩(CP949)을 선택하세요.', 'preparing');
	}
}

export function parseDelimited(input: ParseInput, delimiter: ',' | '\t'): ParseOutput {
	const { text, bom } = decodeText(input.bytes, input.selector.csv_encoding);
	let records: string[][];
	try {
		records = parse(text, {
			delimiter,
			relax_column_count: true,
			skip_empty_lines: false,
			bom: false,
			trim: false
		}) as string[][];
	} catch (e) {
		throw new AppError('PARSE_FAILED', `구분자 파일 형식 오류: ${(e as Error).message.slice(0, 160)}`, 'preparing');
	}
	const warnings: string[] = [];
	if (bom) warnings.push('UTF-8 BOM 감지');
	const headerIdx = (input.selector.header_row ?? 1) - 1;
	const header = records[headerIdx] ?? [];
	const width = Math.max(header.length, ...records.map((r) => r.length));
	const columns = Array.from({ length: width }, (_, i) => ({
		column_id: colLetter(i + 1),
		label: (header[i] ?? '').trim() || colLetter(i + 1),
		index: i + 1
	}));
	const fi = input.fileIndex;
	const rows: Table['rows'] = [];
	records.forEach((rec, i) => {
		if (i <= headerIdx) return;
		if (rec.every((v) => v === '')) return;
		const rowNumber = i + 1;
		if (rec.length !== header.length) warnings.push(`${rowNumber}행의 열 개수(${rec.length})가 헤더(${header.length})와 다름`);
		rows.push({
			record_id: `f${fi}.t0.r${rowNumber}`,
			row_number: rowNumber,
			hidden: false,
			evidence_id: `f${fi}.t0.r${rowNumber}`,
			cells: columns.map((c, ci) => typedFromText(rec[ci] ?? '', c.column_id, `f${fi}.t0!${c.column_id}${rowNumber}`))
		});
	});
	return {
		tables: [
			{
				table_id: `f${fi}.t0`,
				kind: 'csv',
				label: input.name,
				header_row: headerIdx + 1,
				columns,
				rows,
				merged_ranges: []
			}
		],
		texts: [],
		warnings
	};
}
