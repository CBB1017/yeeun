import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import type { TextBlock } from '../../../src/lib/shared/manifest';
import { MIME } from '../../../src/lib/server/parsers/types';
import { allText, expectAppError, input, parse } from '../../fixtures/parsers/helpers';
import { blankPng, exifRotatedJpeg, textJpeg, textPng } from '../../fixtures/parsers/images';

const LINES = ['RECEIPT 5094', '제출 마감 2026-12-15'];

function expectRegionsInside(blocks: TextBlock[], w: number, h: number) {
	expect(blocks.length).toBeGreaterThan(0);
	for (const b of blocks) {
		expect(b.kind).toBe('region');
		expect(b.evidence_id).toMatch(/^f0\.img\.l\d+$/);
		const { left, top, width, height } = b.location as Record<string, number>;
		for (const v of [left, top, width, height]) expect(typeof v).toBe('number');
		expect(width).toBeGreaterThan(0);
		expect(height).toBeGreaterThan(0);
		expect(left + width).toBeLessThanOrEqual(w);
		expect(top + height).toBeLessThanOrEqual(h);
		expect(b.location).toMatchObject({ image_width: w, image_height: h });
		expect(typeof b.ocr_confidence).toBe('number');
	}
}

describe('image OCR fixtures', () => {
	it('PNG: Korean + English lines with region bounds in image pixels', async () => {
		const png = await textPng(LINES, { width: 1400, height: 260, fontSize: 36 });
		const out = await parse(input(png, 'a.png', { mimeType: MIME.png }));
		expectRegionsInside(out.texts, 1400, 260);
		const text = allText(out);
		expect(text).toContain('5094');
		expect(text).toContain('2026-12-15');
		expect(text.replace(/\s/g, '')).toContain('제출마감');
		const a = out.texts.find((t) => t.text.includes('5094'))!;
		const b = out.texts.find((t) => t.text.includes('2026-12-15'))!;
		expect((a.location.top as number) < (b.location.top as number)).toBe(true);
	}, 60_000);

	it('JPEG with EXIF orientation 6 is read upright; bounds in oriented space', async () => {
		const jpeg = await exifRotatedJpeg(LINES, { width: 1400, height: 260, fontSize: 36 });
		const meta = await sharp(jpeg).metadata();
		expect(meta.orientation).toBe(6);
		expect([meta.width, meta.height]).toEqual([260, 1400]);
		const out = await parse(input(jpeg, 'r.jpg', { mimeType: MIME.jpeg }));
		expectRegionsInside(out.texts, 1400, 260);
		expect(out.texts[0]!.location.orientation).toBe(6);
		expect(allText(out)).toContain('5094');
		expect(allText(out)).toContain('2026-12-15');
		// control: the same stored pixels without the EXIF tag are sideways and do not read
		const stripped = await sharp(jpeg).jpeg({ quality: 95 }).toBuffer();
		expect((await sharp(stripped).metadata()).orientation ?? 1).toBe(1);
		const sideways = await parse(input(stripped, 's.jpg'));
		expect(allText(sideways)).not.toContain('2026-12-15');
	}, 60_000);

	it('small text in a small image is upscaled for OCR but bounds map back to the source size', async () => {
		const png = await textPng(['Due 2026-11-30 ref 00731'], { width: 420, height: 60, fontSize: 16, top: 14, left: 10 });
		const out = await parse(input(png, 'small.png'));
		expectRegionsInside(out.texts, 420, 60);
		expect(allText(out)).toContain('2026-11-30');
		expect(allText(out)).toContain('00731');
	}, 60_000);

	it('plain JPEG works the same as PNG', async () => {
		const out = await parse(input(await textJpeg(LINES, { width: 1400, height: 260, fontSize: 36 }), 'b.jpeg'));
		expect(allText(out)).toContain('5094');
	}, 60_000);

	it('blank image: warning, no fabricated text', async () => {
		const out = await parse(input(await blankPng(), 'blank.png'));
		expect(out.texts).toEqual([]);
		expect(out.tables).toEqual([]);
		expect(out.warnings.some((w) => w.includes('인식된 텍스트 없음'))).toBe(true);
	}, 60_000);

	it('OCR budget: image counts as one page and over-limit fails before OCR', async () => {
		const png = await textPng(['X'], { width: 200, height: 100, fontSize: 30 });
		const i = input(png, 'c.png', { maxOcrPages: 3, used: 3 });
		await expectAppError(parse(i), 'SOURCE_TOO_LARGE');
		expect(i.ocrBudget.used).toBe(3);
	});

	it('corrupted image fails with PARSE_FAILED', async () => {
		const png = await textPng(LINES);
		await expectAppError(parse(input(png.subarray(0, 100), 'broken.png')), 'PARSE_FAILED');
		await expectAppError(parse(input(Buffer.from('not an image'), 'x.jpg')), 'PARSE_FAILED');
	});
});
