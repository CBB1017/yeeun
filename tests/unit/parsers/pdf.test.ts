import { beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { MIME } from '../../../src/lib/server/parsers/types';
import { expectAppError, input, parse } from '../../fixtures/parsers/helpers';
import { textSvg } from '../../fixtures/parsers/images';
import { loConvert } from '../../fixtures/parsers/lo';
import { buildPdf, DOC_HTML } from '../../fixtures/parsers/pdf';

const LO_TIMEOUT = 240_000;

/** Full-page "scan": 2550x3300 px (Letter @300dpi) JPEG of rendered text, no text layer. */
async function scanJpeg(lines: string[]): Promise<Buffer> {
	return sharp(textSvg(lines, { width: 2550, height: 3300, fontSize: 32, top: 200, left: 200, lineGap: 70 }))
		.flatten({ background: '#fff' })
		.jpeg({ quality: 90 })
		.toBuffer();
}

const SCAN_LINES = ['SCANNED INVOICE 7731', '납부 기한 2026-11-30', 'Total amount 1,250,000'];

describe('PDF parser fixtures', () => {
	let docPdf: Buffer;
	beforeAll(async () => {
		docPdf = await loConvert(Buffer.from(DOC_HTML, 'utf8'), 'html', 'pdf:writer_pdf_Export', 'HTML (StarWriter)');
	}, LO_TIMEOUT);

	it('text PDF (LibreOffice): Korean + English from the text layer with page evidence', async () => {
		const out = await parse(input(docPdf, 'doc.pdf', { mimeType: MIME.pdf }));
		const p1 = out.texts.find((t) => t.evidence_id === 'f0.p1')!;
		expect(p1).toBeDefined();
		expect(p1.kind).toBe('page');
		expect(p1.location).toMatchObject({ page: 1, source: 'text_layer', rotation: 0 });
		expect(p1.ocr_confidence).toBeNull();
		expect(p1.text).toContain('연구 일정 Research Schedule');
		expect(p1.text).toContain('This document is a deadline verification example.');
		expect(out.warnings.some((w) => w.includes('OCR'))).toBe(false);
	});

	it('multi-column / table layout: columns are not glued into one sentence, table cells kept', async () => {
		const out = await parse(input(docPdf, 'doc.pdf'));
		const text = out.texts.map((t) => t.text).join('\n');
		const lines = text.split('\n');
		const left = lines.find((l) => l.includes('왼쪽 단'))!;
		expect(left).toBeDefined();
		// if both columns share a line they must be tab-separated, never joined by a plain space
		if (left.includes('오른쪽 단')) expect(left).toMatch(/\t[^\t]*오른쪽 단/);
		expect(text).toContain('오른쪽 단: 보고서 제출 마감 2026-11-30.');
		const row = lines.find((l) => l.includes('Proposal'))!;
		expect(row.split('\t')).toEqual(['Proposal', '2026-11-30', '00123']);
	});

	it('rotated page: text layer read, rotation recorded', async () => {
		const pdf = await buildPdf([
			{ kind: 'text', lines: [{ x: 72, y: 700, text: 'Upright page with enough text here' }] },
			{ kind: 'text', rotate: 90, lines: [{ x: 72, y: 700, text: 'Rotated page deadline 2026-12-01 text' }] }
		]);
		const out = await parse(input(pdf, 'rot.pdf'));
		const p2 = out.texts.find((t) => t.evidence_id === 'f0.p2')!;
		expect(p2.location).toMatchObject({ page: 2, rotation: 90, source: 'text_layer' });
		expect(p2.text).toBe('Rotated page deadline 2026-12-01 text');
	});

	it('scanned (image-only) page -> OCR region blocks with page, bounds and confidence (Korean + English)', async () => {
		const pdf = await buildPdf([
			{ kind: 'text', lines: [{ x: 72, y: 700, text: 'Cover page with a real text layer' }] },
			{ kind: 'image', jpeg: await scanJpeg(SCAN_LINES) }
		]);
		const budget = { used: 0 };
		const i = input(pdf, 'mixed.pdf');
		i.ocrBudget = budget;
		const out = await parse(i);
		expect(out.texts.find((t) => t.evidence_id === 'f0.p1')!.location.source).toBe('text_layer');
		const regions = out.texts.filter((t) => t.kind === 'region');
		expect(regions.length).toBeGreaterThanOrEqual(3);
		for (const r of regions) {
			expect(r.evidence_id).toMatch(/^f0\.p2\.l\d+$/);
			expect(r.location).toMatchObject({ page: 2, source: 'ocr', dpi: 300 });
			for (const k of ['left', 'top', 'width', 'height'] as const) expect(typeof r.location[k]).toBe('number');
			expect((r.location.width as number) > 0 && (r.location.height as number) > 0).toBe(true);
			expect(r.ocr_confidence).toBeGreaterThanOrEqual(0);
			expect(r.ocr_confidence).toBeLessThanOrEqual(100);
		}
		const ocr = regions.map((r) => r.text).join('\n');
		expect(ocr).toContain('7731');
		expect(ocr).toContain('2026-11-30');
		expect(ocr.replace(/\s/g, '')).toContain('납부기한');
		expect(ocr).toMatch(/INVOICE/i);
		// the first line's box is above the second's
		const first = regions.find((r) => r.text.includes('7731'))!;
		const second = regions.find((r) => r.text.includes('2026-11-30'))!;
		expect((first.location.top as number) < (second.location.top as number)).toBe(true);
		expect(budget.used).toBe(1);
		expect(out.warnings.some((w) => w.includes('스캔 페이지 OCR 수행: 2쪽'))).toBe(true);
	}, 120_000);

	it('OCR page limit exceeded -> SOURCE_TOO_LARGE (no truncation, budget untouched)', async () => {
		const jpeg = await scanJpeg(['PAGE']);
		const pdf = await buildPdf([
			{ kind: 'image', jpeg },
			{ kind: 'image', jpeg },
			{ kind: 'image', jpeg }
		]);
		const i = input(pdf, 'many.pdf', { maxOcrPages: 2 });
		await expectAppError(parse(i), 'SOURCE_TOO_LARGE');
		expect(i.ocrBudget.used).toBe(0);
		// shared run budget counts pages already OCR'd elsewhere
		await expectAppError(parse(input(pdf, 'many.pdf', { maxOcrPages: 4, used: 2 })), 'SOURCE_TOO_LARGE');
	});

	it(
		'password-protected PDF fails with PARSE_FAILED',
		async () => {
			const enc = await loConvert(
				Buffer.from(DOC_HTML, 'utf8'),
				'html',
				'pdf:writer_pdf_Export:{"EncryptFile":{"type":"boolean","value":"true"},"DocumentOpenPassword":{"type":"string","value":"secret"}}',
				'HTML (StarWriter)'
			);
			expect(enc.includes(Buffer.from('/Encrypt'))).toBe(true);
			const e = await expectAppError(parse(input(enc, 'enc.pdf')), 'PARSE_FAILED');
			expect(e.message).toContain('암호화');
		},
		LO_TIMEOUT
	);

	it('corrupted / non-PDF bytes fail with PARSE_FAILED', async () => {
		await expectAppError(parse(input(Buffer.from('this is not a pdf'), 'x.pdf')), 'PARSE_FAILED');
		await expectAppError(parse(input(Buffer.alloc(0), 'empty.pdf')), 'PARSE_FAILED');
	});
});
