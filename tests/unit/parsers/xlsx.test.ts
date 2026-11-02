import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { MIME } from '../../../src/lib/server/parsers/types';
import { cellAt, expectAppError, input, parse } from '../../fixtures/parsers/helpers';
import { mainWorkbook, xlsmWorkbook } from '../../fixtures/parsers/xlsx';

describe('xlsx parser fixtures', () => {
	it('parses multiple sheets with merged + duplicate headers (warning)', async () => {
		const out = await parse(input(await mainWorkbook(), 'book.xlsx', { mimeType: MIME.xlsx }));
		expect(out.tables.map((t) => t.label)).toEqual(['Data', 'Second', 'Early']);
		const data = out.tables[0]!;
		expect(data.kind).toBe('sheet');
		expect(data.header_row).toBe(1);
		expect(data.merged_ranges).toContain('A1:B1');
		expect(data.columns.map((c) => c.label)).toEqual([
			'Period',
			'Period',
			'Amount',
			'Amount',
			'Due',
			'Double',
			'Uncomputed',
			'Stale',
			'Err'
		]);
		expect(out.warnings.some((w) => w.includes('중복 헤더') && w.includes('Amount') && w.includes('Period'))).toBe(true);
		// sheet/cell evidence
		expect(cellAt(data, 'C2').evidence_id).toBe('f0.s0!C2');
		expect(cellAt(data, 'C2')).toMatchObject({ type: 'number', value: '1234.5' });
		// leading zeros stay text
		expect(cellAt(data, 'B2')).toMatchObject({ type: 'string', value: '00123' });
		expect(out.tables[1]!.rows[0]!.cells[0]).toMatchObject({ type: 'string', value: '001' });
	});

	it('1900 date system: dates are exact YYYY-MM-DD', async () => {
		const out = await parse(input(await mainWorkbook(), 'book.xlsx'));
		const data = out.tables[0]!;
		expect(['E2', 'E3', 'E4', 'E5'].map((r) => cellAt(data, r).value)).toEqual(['2026-11-30', '2024-02-29', '1999-12-31', '2027-01-01']);
		expect(cellAt(data, 'E2').type).toBe('date');
		expect(out.warnings.some((w) => w.includes('1904'))).toBe(false);
	});

	it('1900 date system: pre-March-1900 serials are exact and the fictitious 1900-02-29 is flagged, not corrected', async () => {
		const out = await parse(input(await mainWorkbook(), 'book.xlsx', { selector: { sheet: 'Early' } }));
		const t = out.tables[0]!;
		expect(cellAt(t, 'B2')).toMatchObject({ type: 'date', value: '1900-01-15' });
		expect(cellAt(t, 'B3')).toMatchObject({ type: 'date', value: '1900-02-28' });
		expect(cellAt(t, 'B4')).toMatchObject({ type: 'error', value: null });
		expect(cellAt(t, 'B5')).toMatchObject({ type: 'date', value: '1900-03-01' });
		expect(out.warnings.some((w) => w.includes('1900-02-29'))).toBe(true);
	});

	it('1904 date system: same calendar dates come out identical (with warning)', async () => {
		const out = await parse(input(await mainWorkbook({ date1904: true }), 'book1904.xlsx'));
		const data = out.tables[0]!;
		expect(['E2', 'E3', 'E4', 'E5'].map((r) => cellAt(data, r).value)).toEqual(['2026-11-30', '2024-02-29', '1999-12-31', '2027-01-01']);
		expect(out.warnings.some((w) => w.includes('1904'))).toBe(true);
	});

	it('1904 flag spelled date1904="true" (LibreOffice style) is honoured too', async () => {
		const out = await parse(input(await mainWorkbook({ date1904: true, date1904Attr: 'true' }), 'lo1904.xlsx'));
		const data = out.tables[0]!;
		expect(['E2', 'E3', 'E4', 'E5'].map((r) => cellAt(data, r).value)).toEqual(['2026-11-30', '2024-02-29', '1999-12-31', '2027-01-01']);
		expect(out.warnings.some((w) => w.includes('1904'))).toBe(true);
	});

	it('formulas: cached results used as-is, missing cache -> formula_uncomputed + warning, never recalculated', async () => {
		const out = await parse(input(await mainWorkbook(), 'book.xlsx'));
		const data = out.tables[0]!;
		expect(cellAt(data, 'F2')).toMatchObject({ type: 'number', value: '2469', formula: 'C2*2' });
		expect(cellAt(data, 'G2')).toMatchObject({ type: 'formula_uncomputed', value: null, formula: 'C2+1' });
		// stale cache (C3*3 would be 30) is reported exactly as cached
		expect(cellAt(data, 'H3')).toMatchObject({ type: 'number', value: '999', formula: 'C3*3' });
		expect(cellAt(data, 'I2')).toMatchObject({ type: 'error', value: '#DIV/0!', formula: '1/0' });
		expect(out.warnings.filter((w) => w.includes('계산값이 저장되지 않은 수식')).length).toBeGreaterThanOrEqual(4);
	});

	it('hidden rows are flagged hidden and the warning reflects selector.include_hidden_rows', async () => {
		const bytes = await mainWorkbook();
		const excl = await parse(input(bytes, 'book.xlsx', { selector: { include_hidden_rows: false } }));
		const row4 = excl.tables[0]!.rows.find((r) => r.row_number === 4)!;
		expect(row4.hidden).toBe(true);
		expect(excl.tables[0]!.rows.filter((r) => r.hidden).map((r) => r.row_number)).toEqual([4]);
		expect(excl.warnings.some((w) => w.includes('숨김 행 1개 제외'))).toBe(true);
		const incl = await parse(input(bytes, 'book.xlsx', { selector: { include_hidden_rows: true } }));
		expect(incl.warnings.some((w) => w.includes('숨김 행 1개 포함'))).toBe(true);
	});

	it('chart: series name, category labels, cached values and number format (units)', async () => {
		const out = await parse(input(await mainWorkbook({ chart: true }), 'chart.xlsx'));
		const charts = out.texts.filter((t) => t.kind === 'chart');
		expect(charts).toHaveLength(1);
		const c = charts[0]!;
		expect(c.location).toMatchObject({ chart: 'chart1.xml', sheet: 'Second', title: '분기 매출 (억원)' });
		expect(c.text).toContain('title: 분기 매출 (억원)');
		expect(c.text).toContain('series "Revenue"');
		expect(c.text).toContain('001=1.50');
		expect(c.text).toContain('Q2=2.25');
		expect(c.text).toContain('Q3=3');
		expect(c.text).toContain('#,##0.00"억원"');
		expect(c.text).not.toContain('Second!$B$1');
	});

	it('selector.sheet selects one sheet (and only its charts); unknown sheet -> INPUT_REQUIRED', async () => {
		const bytes = await mainWorkbook({ chart: true });
		const s = await parse(input(bytes, 'chart.xlsx', { selector: { sheet: 'Second' } }));
		expect(s.tables.map((t) => t.label)).toEqual(['Second']);
		expect(s.tables[0]!.table_id).toBe('f0.s1');
		expect(s.texts.filter((t) => t.kind === 'chart')).toHaveLength(1);
		const d = await parse(input(bytes, 'chart.xlsx', { selector: { sheet: 'Data' } }));
		expect(d.tables.map((t) => t.label)).toEqual(['Data']);
		expect(d.texts.filter((t) => t.kind === 'chart')).toHaveLength(0);
		await expectAppError(parse(input(bytes, 'chart.xlsx', { selector: { sheet: 'Nope' } })), 'INPUT_REQUIRED');
	});

	it('header_row selector overrides auto-detection', async () => {
		const out = await parse(input(await mainWorkbook(), 'book.xlsx', { selector: { sheet: 'Second', header_row: 2 } }));
		expect(out.tables[0]!.columns.map((c) => c.label)).toEqual(['001', '1.5']);
		expect(out.tables[0]!.rows.map((r) => r.row_number)).toEqual([3, 4]);
	});

	it('xlsm with a VBA part parses data without executing anything', async () => {
		const marker = '/tmp/yeeun-macro-ran';
		const out = await parse(input(await xlsmWorkbook(), 'macro.xlsm', { mimeType: MIME.xlsm }));
		expect(out.tables[0]!.label).toBe('Macro');
		expect(cellAt(out.tables[0]!, 'B2')).toMatchObject({ type: 'number', value: '5' });
		expect(existsSync(marker)).toBe(false);
	});

	it('corrupted and non-zip xlsx fail with PARSE_FAILED', async () => {
		const good = await mainWorkbook();
		await expectAppError(parse(input(good.subarray(0, Math.floor(good.length / 2)), 'trunc.xlsx')), 'PARSE_FAILED');
		await expectAppError(parse(input(Buffer.from('not a zip at all'), 'junk.xlsx')), 'PARSE_FAILED');
	});
});
