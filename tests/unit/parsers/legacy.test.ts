/**
 * Legacy binary Office (xls/ppt) through the isolated LibreOffice path.
 * Fixtures: generated xlsx/pptx converted by `soffice --headless --convert-to xls/ppt`;
 * encrypted variants are saved with an open password by LibreOffice itself.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { MIME } from '../../../src/lib/server/parsers/types';
import { allText, cellAt, expectAppError, input, parse } from '../../fixtures/parsers/helpers';
import { loConvert, loSaveAs } from '../../fixtures/parsers/lo';
import { simpleDeck } from '../../fixtures/parsers/pptx';
import { mainWorkbook } from '../../fixtures/parsers/xlsx';

const T = 300_000;

describe('xls via LibreOffice', () => {
	let xls: Buffer;
	beforeAll(async () => {
		xls = await loConvert(await mainWorkbook({ chart: true }), 'xlsx', 'xls');
	}, T);

	it('fixture is a real BIFF/CFB xls', () => {
		expect(xls.subarray(0, 8).toString('hex')).toBe('d0cf11e0a1b11ae1');
	});

	it(
		'parses sheets, headers, exact dates, cached formula values, hidden rows and chart',
		async () => {
			const out = await parse(input(xls, 'book.xls', { mimeType: MIME.xls }));
			expect(out.warnings[0]).toContain('구형 xls');
			expect(out.tables.map((t) => t.label)).toEqual(['Data', 'Second', 'Early']);
			const data = out.tables[0]!;
			expect(data.columns.map((c) => c.label).slice(2, 5)).toEqual(['Amount', 'Amount', 'Due']);
			expect(out.warnings.some((w) => w.includes('중복 헤더'))).toBe(true);
			expect(['E2', 'E3', 'E4', 'E5'].map((r) => cellAt(data, r).value)).toEqual(['2026-11-30', '2024-02-29', '1999-12-31', '2027-01-01']);
			expect(cellAt(data, 'B2')).toMatchObject({ type: 'string', value: '00123' });
			expect(cellAt(data, 'F2')).toMatchObject({ type: 'number', value: '2469' });
			expect(cellAt(data, 'F2').formula).toMatch(/C2\*2/);
			expect(data.rows.find((r) => r.row_number === 4)!.hidden).toBe(true);
			const chart = out.texts.find((t) => t.kind === 'chart');
			expect(chart, 'chart survives xlsx->xls->xlsx').toBeDefined();
			expect(chart!.text).toContain('Revenue');
			expect(chart!.text).toContain('Q2=2.25');
		},
		T
	);

	it(
		'1904 workbook converted to xls still yields the same calendar dates',
		async () => {
			const x = await loConvert(await mainWorkbook({ date1904: true }), 'xlsx', 'xls');
			const out = await parse(input(x, 'b1904.xls'));
			const data = out.tables[0]!;
			expect(['E2', 'E3', 'E4', 'E5'].map((r) => cellAt(data, r).value)).toEqual(['2026-11-30', '2024-02-29', '1999-12-31', '2027-01-01']);
		},
		T
	);

	it(
		'password-protected xls fails with PARSE_FAILED (control: same pipeline without password parses)',
		async () => {
			const src = await mainWorkbook();
			const plain = await loSaveAs(src, 'xlsx', 'xls', 'MS Excel 97', '');
			const ok = await parse(input(plain, 'plain.xls'));
			expect(ok.tables[0]!.label).toBe('Data');
			const enc = await loSaveAs(src, 'xlsx', 'xls', 'MS Excel 97', 'secret');
			expect(enc.equals(plain)).toBe(false);
			// really encrypted: the shared-string text present in the plain file is gone
			expect(plain.includes(Buffer.from('Uncomputed'))).toBe(true);
			expect(enc.includes(Buffer.from('Uncomputed'))).toBe(false);
			await expectAppError(parse(input(enc, 'enc.xls')), 'PARSE_FAILED');
		},
		T
	);

	// SKIP: LibreOffice 7.4 storeToURL(Password) on "Calc MS Excel 2007 XML" writes a plain,
	// unencrypted zip (verified: output starts with PK), and no other OOXML encryptor is available
	// in this toolchain (no python/msoffcrypto, no npm dep allowed). Behaviour is covered indirectly:
	// an encrypted OOXML file is a CFB container, which fails the zip open -> PARSE_FAILED (see junk tests).
	it.skip(
		'password-protected (encrypted OOXML) xlsx fails with PARSE_FAILED',
		async () => {
			const enc = await loSaveAs(await mainWorkbook(), 'xlsx', 'xlsx', 'Calc MS Excel 2007 XML', 'secret');
			expect(enc.subarray(0, 8).toString('hex')).toBe('d0cf11e0a1b11ae1'); // CFB container, not a zip
			await expectAppError(parse(input(enc, 'enc.xlsx')), 'PARSE_FAILED');
		},
		T
	);

	it(
		'corrupted xls fails with PARSE_FAILED',
		async () => {
			await expectAppError(parse(input(xls.subarray(0, 1024), 'trunc.xls')), 'PARSE_FAILED');
			await expectAppError(parse(input(Buffer.from('garbage bytes, not BIFF'), 'junk.xls')), 'PARSE_FAILED');
		},
		T
	);
});

describe('ppt via LibreOffice', () => {
	let ppt: Buffer;
	let pptx: Buffer;
	beforeAll(async () => {
		pptx = await simpleDeck();
		ppt = await loConvert(pptx, 'pptx', 'ppt');
	}, T);

	it('fixture is a real CFB ppt', () => {
		expect(ppt.subarray(0, 8).toString('hex')).toBe('d0cf11e0a1b11ae1');
	});

	it(
		'parses slide text with slide index, notes only when requested, table',
		async () => {
			const out = await parse(input(ppt, 'deck.ppt', { mimeType: MIME.ppt }));
			expect(out.warnings[0]).toContain('구형 ppt');
			const s1 = out.texts.find((t) => t.evidence_id === 'f0.sl1')!;
			expect(s1.location).toMatchObject({ slide: 1 });
			expect(s1.text).toContain('Legacy deck 레거시 슬라이드');
			expect(out.texts.some((t) => t.kind === 'notes')).toBe(false);
			const withNotes = await parse(input(ppt, 'deck.ppt', { selector: { include_notes: true } }));
			expect(withNotes.texts.find((t) => t.kind === 'notes')!.text).toContain('legacy note');
			const tableText = [
				...out.tables.flatMap((t) => [...t.columns.map((c) => c.label), ...t.rows.flatMap((r) => r.cells.map((c) => c.value ?? ''))]),
				allText(out)
			].join(' ');
			expect(tableText).toContain('Score');
			expect(tableText).toContain('90');
		},
		T
	);

	// SKIP: LibreOffice 7.4's "MS PowerPoint 97" export ignores the Password property (verified: the
	// "encrypted" output is byte-identical in size and still contains the slide text in clear), so a
	// genuinely password-protected .ppt cannot be produced in this toolchain.
	it.skip(
		'password-protected ppt fails with PARSE_FAILED (control: same pipeline without password parses)',
		async () => {
			const plain = await loSaveAs(pptx, 'pptx', 'ppt', 'MS PowerPoint 97', '');
			const ok = await parse(input(plain, 'plain.ppt'));
			expect(allText(ok)).toContain('Legacy deck');
			const enc = await loSaveAs(pptx, 'pptx', 'ppt', 'MS PowerPoint 97', 'secret');
			await expectAppError(parse(input(enc, 'enc.ppt')), 'PARSE_FAILED');
		},
		T
	);

	// SKIP: same LibreOffice limitation as for encrypted xlsx (Password ignored for OOXML export).
	it.skip(
		'password-protected (encrypted OOXML) pptx fails with PARSE_FAILED',
		async () => {
			const enc = await loSaveAs(pptx, 'pptx', 'pptx', 'Impress MS PowerPoint 2007 XML', 'secret');
			expect(enc.subarray(0, 8).toString('hex')).toBe('d0cf11e0a1b11ae1');
			await expectAppError(parse(input(enc, 'enc.pptx')), 'PARSE_FAILED');
		},
		T
	);

	it(
		'corrupted ppt fails with PARSE_FAILED',
		async () => {
			await expectAppError(parse(input(ppt.subarray(0, 1024), 'trunc.ppt')), 'PARSE_FAILED');
			await expectAppError(parse(input(Buffer.from('garbage bytes, not a presentation'), 'junk.ppt')), 'PARSE_FAILED');
		},
		T
	);
});
