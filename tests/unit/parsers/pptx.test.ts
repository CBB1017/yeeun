import { beforeAll, describe, expect, it } from 'vitest';
import { MIME } from '../../../src/lib/server/parsers/types';
import { allText, expectAppError, input, parse } from '../../fixtures/parsers/helpers';
import { deck } from '../../fixtures/parsers/pptx';

describe('pptx parser fixtures (pptxgenjs)', () => {
	let bytes: Buffer;
	beforeAll(async () => {
		bytes = await deck();
	});

	it('slide text keeps runs together, leading zeros and slide index in location', async () => {
		const out = await parse(input(bytes, 'deck.pptx', { mimeType: MIME.pptx }));
		const s1 = out.texts.find((t) => t.evidence_id === 'f0.sl1')!;
		expect(s1.kind).toBe('slide');
		expect(s1.location).toMatchObject({ slide: 1, hidden: false });
		expect(s1.text).toContain('분기 보고서 Quarterly Report');
		expect(s1.text).toContain('Total 1,234 units');
		expect(s1.text).toContain('Code 00123');
		expect(s1.text.split('\n')).toContain('0042');
		const s6 = out.texts.find((t) => t.evidence_id === 'f0.sl6')!;
		expect(s6.location).toMatchObject({ slide: 6 });
		expect(s6.text).toBe('Final slide');
	}, 120_000);

	it('table becomes a slide_table with typed cells (leading zeros kept)', async () => {
		const out = await parse(input(bytes, 'deck.pptx'));
		expect(out.tables).toHaveLength(1);
		const t = out.tables[0]!;
		expect(t.kind).toBe('slide_table');
		expect(t.table_id).toBe('f0.sl2.t0');
		expect(t.columns.map((c) => c.label)).toEqual(['Item', 'Qty', 'Code']);
		expect(t.rows[0]!.cells.map((c) => [c.type, c.value])).toEqual([
			['string', 'bolt'],
			['number', '5'],
			['string', '00123']
		]);
		expect(t.rows[1]!.cells[1]).toMatchObject({ type: 'number', value: '7.50' });
		expect(t.rows[1]!.cells[2]).toMatchObject({ type: 'string', value: '0042' });
		// slide text does not duplicate table cells
		expect(out.texts.find((x) => x.evidence_id === 'f0.sl2')!.text).not.toContain('bolt');
	}, 120_000);

	it('chart: cached series/categories/values per slide', async () => {
		const out = await parse(input(bytes, 'deck.pptx'));
		const charts = out.texts.filter((t) => t.kind === 'chart');
		expect(charts).toHaveLength(1);
		const c = charts[0]!;
		expect(c.location).toMatchObject({ slide: 3 });
		expect(c.text).toContain('series "Revenue"');
		expect(c.text).toContain('001=1.5');
		expect(c.text).toContain('Q2=2.25');
		expect(c.text).toContain('Q3=3');
		expect(c.text).toContain('Sales chart');
	}, 120_000);

	it("image with text is OCR'd into region blocks on its slide", async () => {
		const out = await parse(input(bytes, 'deck.pptx'));
		const regions = out.texts.filter((t) => t.kind === 'region');
		expect(regions.length).toBeGreaterThan(0);
		for (const r of regions) {
			expect(r.location.slide).toBe(4);
			expect(r.evidence_id.startsWith('f0.sl4.')).toBe(true);
			expect(typeof r.location.left).toBe('number');
			expect(typeof r.location.width).toBe('number');
			expect(typeof r.ocr_confidence).toBe('number');
		}
		const ocr = regions.map((r) => r.text).join(' ');
		expect(ocr).toContain('4821');
		expect(ocr.replace(/\s/g, '')).toContain('납부');
	}, 120_000);

	it('speaker notes only when selector.include_notes', async () => {
		const without = await parse(input(bytes, 'deck.pptx'));
		expect(without.texts.some((t) => t.kind === 'notes')).toBe(false);
		expect(allText(without)).not.toContain('speaker-only note 77');
		const withNotes = await parse(input(bytes, 'deck.pptx', { selector: { include_notes: true } }));
		const notes = withNotes.texts.filter((t) => t.kind === 'notes');
		expect(notes).toHaveLength(1);
		expect(notes[0]!.evidence_id).toBe('f0.sl1.notes');
		expect(notes[0]!.location).toMatchObject({ slide: 1 });
		expect(notes[0]!.text).toContain('발표자 메모: speaker-only note 77');
	}, 120_000);

	it('hidden slide excluded unless include_hidden_slides (numbering unchanged)', async () => {
		const excl = await parse(input(bytes, 'deck.pptx'));
		expect(excl.texts.some((t) => t.location.slide === 5)).toBe(false);
		expect(allText(excl)).not.toContain('Hidden slide content');
		expect(excl.warnings.some((w) => w.includes('숨김 슬라이드 5'))).toBe(true);
		const incl = await parse(input(bytes, 'deck.pptx', { selector: { include_hidden_slides: true } }));
		const s5 = incl.texts.find((t) => t.evidence_id === 'f0.sl5')!;
		expect(s5.location).toMatchObject({ slide: 5, hidden: true });
		expect(s5.text).toContain('Hidden slide content');
	}, 120_000);

	it('OCR budget is shared and enforced for slide images', async () => {
		await expectAppError(parse(input(bytes, 'deck.pptx', { maxOcrPages: 1, used: 1 })), 'SOURCE_TOO_LARGE');
	}, 120_000);

	it('corrupted pptx fails with PARSE_FAILED', async () => {
		await expectAppError(parse(input(bytes.subarray(0, 2000), 'broken.pptx')), 'PARSE_FAILED');
		await expectAppError(parse(input(Buffer.from('PK\u0003\u0004garbage'), 'junk.pptx')), 'PARSE_FAILED');
	});
});
