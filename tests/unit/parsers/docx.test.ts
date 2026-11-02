/**
 * Word (.docx/.docm/.doc) parser.
 * Fixtures: a Flat ODT converted by LibreOffice to real .docx and .doc, plus a
 * hand-made WordprocessingML zip for tracked changes / fields / text boxes.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { MIME } from '../../../src/lib/server/parsers/types';
import { allText, cellAt, expectAppError, input, parse } from '../../fixtures/parsers/helpers';
import { loConvert, loSaveAs } from '../../fixtures/parsers/lo';
import { DOC_IMAGE_LINES, encryptedOoxml, fodt, handDocx } from '../../fixtures/parsers/docx';

const T = 300_000;

function tableText(out: Awaited<ReturnType<typeof parse>>): string[][] {
	const t = out.tables[0]!;
	return [t.columns.map((c) => c.label), ...t.rows.map((r) => r.cells.map((c) => c.value ?? ''))];
}

describe('docx: hand-made WordprocessingML', () => {
	let bytes: Buffer;
	beforeAll(async () => {
		bytes = await handDocx();
	});

	it('accepted-state text in run order, merged short paragraphs, heading on its own', async () => {
		const out = await parse(input(bytes, 'tracked.docx', { mimeType: MIME.docx }));
		const h = out.texts.find((t) => t.evidence_id === 'f0.d.p1')!;
		expect(h).toMatchObject({ kind: 'paragraph', text: '제목 Title', location: { paragraph: 1, style: 'heading 1', heading: 1 } });
		const p = out.texts.find((t) => t.evidence_id === 'f0.d.p2')!;
		expect(p.location).toMatchObject({ from: 2, to: 5 });
		expect(p.text).toBe('Hello inserted world\t0012\n끝 가\n링크 link / 42 / 7 메모 대상\n상자 앞');
		const after = out.texts.find((t) => t.evidence_id === 'f0.d.p6')!;
		expect(after).toMatchObject({ text: '수식 각주 문장', location: { paragraph: 6 } });
		const all = allText(out);
		for (const gone of ['deleted', 'COMMENT-ONLY', 'PAGE', 'NUMPAGES', 'x=1', 'deleted row']) expect(all).not.toContain(gone);
	});

	it('text box read once (mc:Choice, not the Fallback copy)', async () => {
		const out = await parse(input(bytes, 'tracked.docx'));
		const tb = out.texts.filter((t) => t.text.includes('TEXTBOX'));
		expect(tb).toHaveLength(1);
		expect(tb[0]).toMatchObject({ evidence_id: 'f0.d.tb1', text: '텍스트상자 TEXTBOX', location: { part: 'textbox', paragraph: 5 } });
	});

	it('table: gridSpan/vMerge recorded, deleted row dropped, typed cells, evidence convention', async () => {
		const out = await parse(input(bytes, 'tracked.docx'));
		expect(out.tables).toHaveLength(1);
		const t = out.tables[0]!;
		expect(t).toMatchObject({ table_id: 'f0.d.t0', kind: 'doc_table', header_row: 1 });
		expect(t.merged_ranges).toEqual(['A2:B2', 'A3:A4']);
		expect(tableText(out)).toEqual([
			['A', 'B', 'C'],
			['merged AB', '', '00123'],
			['v1', 'b3', '3.5'],
			['', 'b4', '2026-11-30']
		]);
		expect(cellAt(t, 'C2')).toMatchObject({ type: 'string', value: '00123', evidence_id: 'f0.d.t0!C2' });
		expect(cellAt(t, 'C3')).toMatchObject({ type: 'number', value: '3.5' });
		expect(cellAt(t, 'C4')).toMatchObject({ type: 'date', value: '2026-11-30' });
		for (const r of t.rows) {
			expect(r.evidence_id).toBe(`${t.table_id}.r${r.row_number}`);
			expect(r.record_id).toBe(r.evidence_id);
		}
	});

	it('footnote as its own block; separators skipped', async () => {
		const out = await parse(input(bytes, 'tracked.docx'));
		const fn = out.texts.filter((t) => t.location.part === 'footnote');
		expect(fn).toHaveLength(1);
		expect(fn[0]).toMatchObject({ evidence_id: 'f0.d.fn1', text: '각주 HAND-FN', location: { footnote: 1 } });
	});

	it('warnings: tracked changes, comments, math, symbol characters', async () => {
		const out = await parse(input(bytes, 'tracked.docx'));
		expect(out.warnings.some((w) => w.includes('변경 내용 추적 표시 3건') && w.includes('모두 수락'))).toBe(true);
		expect(out.warnings.some((w) => w.includes('메모(댓글) 1개'))).toBe(true);
		expect(out.warnings.some((w) => w.includes('수식 1개'))).toBe(true);
		expect(out.warnings.some((w) => w.includes('기호 글꼴 문자 1개'))).toBe(true);
	});

	it('altChunk content is refused instead of partial success', async () => {
		await expectAppError(parse(input(await handDocx({ altChunk: true }), 'alt.docx')), 'UNSUPPORTED_FORMAT');
	});

	it('encrypted OOXML container and corrupted zips fail with PARSE_FAILED', async () => {
		const e = await expectAppError(parse(input(encryptedOoxml(), 'enc.docx')), 'PARSE_FAILED');
		expect(e.message).toContain('암호');
		await expectAppError(parse(input(bytes.subarray(0, 300), 'trunc.docx')), 'PARSE_FAILED');
		await expectAppError(parse(input(Buffer.from('PK\u0003\u0004garbage'), 'junk.docx')), 'PARSE_FAILED');
		await expectAppError(parse(input(Buffer.from('plain text, not a Word file'), 'junk.docx')), 'PARSE_FAILED');
	});
});

describe('docx/doc produced by LibreOffice', () => {
	let src: Buffer;
	let docx: Buffer;
	let doc: Buffer;
	beforeAll(async () => {
		src = await fodt();
		docx = await loConvert(src, 'fodt', 'docx');
		doc = await loConvert(src, 'fodt', 'doc');
	}, T);

	it('fixtures are a real OOXML zip and a real CFB doc', () => {
		expect(docx.subarray(0, 2).toString('latin1')).toBe('PK');
		expect(doc.subarray(0, 8).toString('hex')).toBe('d0cf11e0a1b11ae1');
	});

	for (const variant of ['docx', 'doc'] as const) {
		it(
			`${variant}: paragraphs, heading, header/footer, footnote, merged table, image OCR`,
			async () => {
				const bytes = variant === 'docx' ? docx : doc;
				const out = await parse(input(bytes, `report.${variant}`, { mimeType: MIME[variant] }));
				if (variant === 'doc') expect(out.warnings[0]).toContain('구형 doc');
				const body = out.texts.filter((t) => t.kind === 'paragraph' && !t.location.part);
				expect(body[0]).toMatchObject({ evidence_id: 'f0.d.p1', text: '개요 Overview', location: { heading: 1 } });
				const merged = body[1]!;
				expect(merged.location).toMatchObject({ from: 2, to: 4 });
				expect(merged.text).toBe('첫 문단 First paragraph.\n탭\t구분 and line\nbreak\n각주가 있는 문장');
				expect(body.some((b) => b.text === '표 다음 After table\n마지막 문단 Last.' || b.text.startsWith('표 다음 After table'))).toBe(true);
				expect(allText(out)).toContain('마지막 문단 Last.');
				// body paragraphs never repeat table cells
				expect(body.map((b) => b.text).join('\n')).not.toContain('볼트');

				const parts = Object.fromEntries(out.texts.filter((t) => t.location.part).map((t) => [t.location.part, t.text]));
				expect(parts.header).toBe('머리글 HEADER-TXT');
				expect(parts.footer).toBe('바닥글 FOOTER-TXT');
				expect(parts.footnote).toBe('각주 FOOTNOTE-1');

				expect(out.tables).toHaveLength(1);
				const t = out.tables[0]!;
				expect(t.kind).toBe('doc_table');
				expect(tableText(out)).toEqual([
					['품목', '코드', '수량'],
					['볼트', '00123', '5'],
					['너트 세트', '', '7.50'],
					['와셔', '0042', '']
				]);
				expect(t.merged_ranges.sort()).toEqual(['A3:B3', 'C3:C4']);
				expect(cellAt(t, 'B2')).toMatchObject({ type: 'string', value: '00123' });
				expect(cellAt(t, 'B4')).toMatchObject({ type: 'string', value: '0042' });
				expect(cellAt(t, 'C3')).toMatchObject({ type: 'number', value: '7.50' });

				const regions = out.texts.filter((x) => x.kind === 'region');
				expect(regions.length).toBeGreaterThan(0);
				for (const r of regions) expect(r.evidence_id).toMatch(/^f0\.d\.[A-Za-z0-9_]+\.l\d+$/);
				const ocr = regions.map((r) => r.text).join(' ');
				expect(ocr).toContain(DOC_IMAGE_LINES[0]!.split(' ')[1]);
				expect(ocr.replace(/\s/g, '')).toContain('납부');
			},
			T
		);
	}

	it(
		'OCR budget is shared and enforced for embedded images',
		async () => {
			await expectAppError(parse(input(docx, 'report.docx', { maxOcrPages: 1, used: 1 })), 'SOURCE_TOO_LARGE');
		},
		T
	);

	it(
		'a .doc name with OOXML content is parsed as docx (container decides)',
		async () => {
			const out = await parse(input(docx, 'renamed.doc', { mimeType: MIME.doc }));
			expect(out.warnings.some((w) => w.includes('구형 doc'))).toBe(false);
			expect(out.tables).toHaveLength(1);
		},
		T
	);

	it(
		'password-protected doc fails with PARSE_FAILED (control: same pipeline without password parses)',
		async () => {
			const plain = await loSaveAs(src, 'fodt', 'doc', 'MS Word 97', '');
			expect(allText(await parse(input(plain, 'plain.doc')))).toContain('First paragraph');
			const enc = await loSaveAs(src, 'fodt', 'doc', 'MS Word 97', 'secret');
			// really encrypted: body text present in the plain file is gone
			expect(plain.includes(Buffer.from('First paragraph', 'utf16le'))).toBe(true);
			expect(enc.includes(Buffer.from('First paragraph', 'utf16le'))).toBe(false);
			await expectAppError(parse(input(enc, 'enc.doc')), 'PARSE_FAILED');
		},
		T
	);

	it(
		'corrupted doc fails with PARSE_FAILED',
		async () => {
			await expectAppError(parse(input(doc.subarray(0, 1024), 'trunc.doc')), 'PARSE_FAILED');
			await expectAppError(parse(input(Buffer.from('garbage bytes, not a Word document'), 'junk.doc')), 'PARSE_FAILED');
		},
		T
	);
});
