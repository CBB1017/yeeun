import { describe, expect, it } from 'vitest';
import iconv from 'iconv-lite';
import { MIME } from '../../../src/lib/server/parsers/types';
import { cellAt, expectAppError, input, parse } from '../../fixtures/parsers/helpers';

const KO = '이름,금액,코드,마감일\n김철수,"1,234",00123,2026-11-30\n이영희,500,0042,2026-02-30\n';

describe('CSV/TSV parser fixtures', () => {
	it('UTF-8 CSV: header, typed cells, leading zeros kept as strings, invalid dates not corrected', async () => {
		const out = await parse(input(Buffer.from(KO, 'utf8'), 'a.csv', { mimeType: MIME.csv }));
		const t = out.tables[0]!;
		expect(t.kind).toBe('csv');
		expect(t.columns.map((c) => c.label)).toEqual(['이름', '금액', '코드', '마감일']);
		expect(cellAt(t, 'A2')).toMatchObject({ type: 'string', value: '김철수', evidence_id: 'f0.t0!A2' });
		expect(cellAt(t, 'B2')).toMatchObject({ type: 'string', value: '1,234' });
		expect(cellAt(t, 'C2')).toMatchObject({ type: 'string', value: '00123' });
		expect(cellAt(t, 'C3')).toMatchObject({ type: 'string', value: '0042' });
		expect(cellAt(t, 'B3')).toMatchObject({ type: 'number', value: '500' });
		expect(cellAt(t, 'D2')).toMatchObject({ type: 'date', value: '2026-11-30' });
		expect(cellAt(t, 'D3')).toMatchObject({ type: 'string', value: '2026-02-30' });
		expect(out.warnings.some((w) => w.includes('BOM'))).toBe(false);
	});

	it('UTF-8 BOM is stripped from the first header and reported', async () => {
		const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(KO, 'utf8')]);
		const out = await parse(input(bytes, 'bom.csv'));
		expect(out.tables[0]!.columns[0]!.label).toBe('이름');
		expect(out.warnings.some((w) => w.includes('BOM'))).toBe(true);
	});

	it('CP949 bytes decode only when selector.csv_encoding = cp949', async () => {
		const bytes = iconv.encode(KO, 'cp949');
		expect(bytes.equals(Buffer.from(KO, 'utf8'))).toBe(false);
		const out = await parse(input(bytes, 'cp.csv', { selector: { csv_encoding: 'cp949' } }));
		expect(out.tables[0]!.columns.map((c) => c.label)).toEqual(['이름', '금액', '코드', '마감일']);
		expect(cellAt(out.tables[0]!, 'A3').value).toBe('이영희');
		// default UTF-8 mode must fail instead of producing mojibake
		await expectAppError(parse(input(bytes, 'cp.csv')), 'PARSE_FAILED');
	});

	it('quoted delimiters, quoted newlines and escaped quotes are preserved', async () => {
		const csv = 'id,memo,amount\n1,"a, b",10\n2,"line1\nline2",20\n3,"say ""hi""",30\n';
		const out = await parse(input(Buffer.from(csv), 'q.csv'));
		const t = out.tables[0]!;
		expect(t.rows).toHaveLength(3);
		expect(t.rows.map((r) => r.cells[1]!.value)).toEqual(['a, b', 'line1\nline2', 'say "hi"']);
		expect(t.rows.map((r) => r.cells[2]!.value)).toEqual(['10', '20', '30']);
	});

	it('TSV with tabs, commas in values and leading zeros', async () => {
		const tsv = 'code\tname\tqty\n00123\tSmith, J\t5\n000\t"tab\there"\t-1.50\n';
		const out = await parse(input(Buffer.from(tsv), 'b.tsv', { mimeType: MIME.tsv }));
		const t = out.tables[0]!;
		expect(t.columns.map((c) => c.label)).toEqual(['code', 'name', 'qty']);
		expect(cellAt(t, 'A2')).toMatchObject({ type: 'string', value: '00123' });
		expect(cellAt(t, 'B2').value).toBe('Smith, J');
		expect(cellAt(t, 'A3')).toMatchObject({ type: 'string', value: '000' });
		expect(cellAt(t, 'B3').value).toBe('tab\there');
		expect(cellAt(t, 'C3')).toMatchObject({ type: 'number', value: '-1.50' });
	});

	it('formula-like text stays inert text (no evaluation)', async () => {
		const out = await parse(input(Buffer.from('a,b\n=1+1,@SUM(A1)\n'), 'f.csv'));
		expect(cellAt(out.tables[0]!, 'A2')).toMatchObject({ type: 'string', value: '=1+1', formula: null });
		expect(cellAt(out.tables[0]!, 'B2')).toMatchObject({ type: 'string', value: '@SUM(A1)' });
	});

	it('ragged rows are warned, malformed quoting fails with PARSE_FAILED', async () => {
		const out = await parse(input(Buffer.from('a,b\n1,2,3\n4\n'), 'r.csv'));
		expect(out.warnings.filter((w) => w.includes('열 개수')).length).toBe(2);
		await expectAppError(parse(input(Buffer.from('a,b\n"unterminated,1\n'), 'bad.csv')), 'PARSE_FAILED');
	});
});
