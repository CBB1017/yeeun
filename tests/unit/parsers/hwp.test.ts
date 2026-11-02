/**
 * Hangul (.hwpx / .hwp) parsers. All fixtures are hand-built from the public
 * OWPML / HWP 5.0 specifications (tests/fixtures/parsers/hwp.ts); no file
 * written by Hancom Office is part of this suite.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { MIME } from '../../../src/lib/server/parsers/types';
import { decodeParaText } from '../../../src/lib/server/parsers/hwp';
import type { ParseOutput } from '../../../src/lib/server/parsers/types';
import { allText, cellAt, expectAppError, input, parse } from '../../fixtures/parsers/helpers';
import { hwp3Garbage, hwp5, hwpx } from '../../fixtures/parsers/hwp';

const T = 120_000;

function grid(out: ParseOutput): string[][] {
	const t = out.tables[0]!;
	return [t.columns.map((c) => c.label), ...t.rows.map((r) => r.cells.map((c) => c.value ?? ''))];
}

function expectEvidenceConvention(out: ParseOutput) {
	for (const t of out.tables) {
		for (const r of t.rows) {
			expect(r.evidence_id).toBe(`${t.table_id}.r${r.row_number}`);
			expect(r.record_id).toBe(r.evidence_id);
			for (const c of r.cells) expect(c.evidence_id).toBe(`${t.table_id}!${c.column_id}${r.row_number}`);
		}
	}
}

const SAME_TABLE = [
	['항목', '코드', '수량'],
	['볼트 세트', '', '0042'],
	['너트', '7.50', '']
];

describe('hwpx (OWPML)', () => {
	let bytes: Buffer;
	beforeAll(async () => {
		bytes = await hwpx();
	});

	it(
		'paragraphs in section order: heading alone, short paragraphs merged with range, tabs/line breaks kept',
		async () => {
			const out = await parse(input(bytes, '보고서.hwpx', { mimeType: MIME.hwpx }));
			const body = out.texts.filter((t) => t.kind === 'paragraph' && !t.location.part);
			expect(body.map((b) => [b.evidence_id, b.location, b.text])).toEqual([
				['f0.d.p1', { paragraph: 1, section: 1, style: '개요 1', heading: 1 }, '1. 개요 Overview'],
				['f0.d.p2', { from: 2, to: 4, section: 1 }, '본문 첫 문단 First\n탭\t구분\n둘째 줄\n유지 끝 삽입'],
				['f0.d.p7', { from: 7, to: 8, section: 1 }, '각주 문장\n시작 0012 끝'],
				['f0.d.p9', { paragraph: 9, section: 2 }, '둘째 구역 Section two']
			]);
			expect(allText(out)).not.toContain('삭제됨');
			expect(out.warnings.some((w) => w.includes('변경 내용 추적 표시 2건'))).toBe(true);
		},
		T
	);

	it(
		'table from cellAddr/cellSpan with merged ranges, typed cells and caption',
		async () => {
			const out = await parse(input(bytes, 'a.hwpx'));
			expect(out.tables).toHaveLength(1);
			const t = out.tables[0]!;
			expect(t).toMatchObject({ table_id: 'f0.d.t0', kind: 'doc_table' });
			expect(grid(out)).toEqual(SAME_TABLE);
			expect(t.merged_ranges).toEqual(['A2:B2', 'C2:C3']);
			expect(cellAt(t, 'C2')).toMatchObject({ type: 'string', value: '0042' });
			expect(cellAt(t, 'B3')).toMatchObject({ type: 'number', value: '7.50' });
			expectEvidenceConvention(out);
			expect(out.texts.find((x) => x.evidence_id === 'f0.d.cap1')).toMatchObject({
				text: '표 제목 CAPTION',
				location: { part: 'caption', section: 1, paragraph: 5 }
			});
			const body = out.texts.filter((x) => !x.location.part).map((x) => x.text).join('\n');
			expect(body).not.toContain('볼트');
		},
		T
	);

	it(
		'header and footnote as separate blocks; BinData image OCR',
		async () => {
			const out = await parse(input(bytes, 'a.hwpx'));
			expect(out.texts.find((x) => x.location.part === 'header')).toMatchObject({ evidence_id: 'f0.d.hdr1', text: '머리글 HWPX-HEADER' });
			expect(out.texts.find((x) => x.location.part === 'footnote')).toMatchObject({ evidence_id: 'f0.d.fn1', text: '각주 HWPX-FN' });
			const regions = out.texts.filter((x) => x.kind === 'region');
			expect(regions.length).toBeGreaterThan(0);
			for (const r of regions) {
				expect(r.evidence_id).toMatch(/^f0\.d\.image1_png\.l\d+$/);
				expect(r.location).toMatchObject({ image: 'image1.png', section: 1, paragraph: 6 });
			}
			const ocr = regions.map((r) => r.text).join(' ');
			expect(ocr).toContain('4821');
			expect(ocr.replace(/\s/g, '')).toContain('납부');
		},
		T
	);

	it('OCR budget is shared and enforced', async () => {
		await expectAppError(parse(input(bytes, 'a.hwpx', { maxOcrPages: 1, used: 1 })), 'SOURCE_TOO_LARGE');
	});

	it('encrypted package, wrong mimetype, missing section and corrupted zip fail with PARSE_FAILED', async () => {
		const e = await expectAppError(parse(input(await hwpx({ encrypted: true }), 'enc.hwpx')), 'PARSE_FAILED');
		expect(e.message).toContain('암호');
		await expectAppError(parse(input(await hwpx({ mimetype: 'application/epub+zip' }), 'x.hwpx')), 'PARSE_FAILED');
		await expectAppError(parse(input(await hwpx({ missingSection: true }), 'x.hwpx')), 'PARSE_FAILED');
		await expectAppError(parse(input(bytes.subarray(0, 400), 'trunc.hwpx')), 'PARSE_FAILED');
		await expectAppError(parse(input(Buffer.from('not a hangul file'), 'junk.hwpx')), 'PARSE_FAILED');
	});
});

describe('hwp 5.x (CFB records)', () => {
	let bytes: Buffer;
	beforeAll(async () => {
		bytes = await hwp5();
	});

	it('PARA_TEXT control characters: 1-WCHAR chars mapped, 8-WCHAR controls skipped', () => {
		const w = (...units: number[]) => {
			const b = Buffer.alloc(units.length * 2);
			units.forEach((u, i) => b.writeUInt16LE(u, i * 2));
			return b;
		};
		const ext = (code: number) => [code, 0x6c62, 0x7420, 0, 0, 0, 0, code];
		expect(decodeParaText(w(0x41, 10, 0x42, ...ext(9), 0x43, 30, 0x44, 24, 0x45, 31, 0x46, ...ext(11), ...ext(17), 0x47, 0, 13))).toBe('A\nB\tC D-E FG');
	});

	it(
		'paragraphs across sections, heading style, header/footnote parts, hidden comment excluded',
		async () => {
			const out = await parse(input(bytes, '계약서.hwp', { mimeType: MIME.hwp }));
			const body = out.texts.filter((t) => t.kind === 'paragraph' && !t.location.part);
			expect(body.map((b) => [b.evidence_id, b.location, b.text])).toEqual([
				['f0.d.p1', { paragraph: 1, section: 1, style: '개요 1', heading: 1 }, '제1조 목적 Purpose'],
				['f0.d.p2', { from: 2, to: 4, section: 1 }, '본문 첫 줄\n둘째 줄\t탭 뒤 묶음-하이픈 끝\n코드 0012 English 섞임'],
				['f0.d.p6', { from: 6, to: 7, section: 1 }, '각주 문장\n숨은 설명'],
				['f0.d.p8', { paragraph: 8, section: 2 }, '둘째 구역 Section two']
			]);
			expect(out.texts.find((x) => x.location.part === 'header')).toMatchObject({
				evidence_id: 'f0.d.hdr1',
				text: '머리글 HWP-HEADER',
				location: { section: 1, paragraph: 2 }
			});
			expect(out.texts.find((x) => x.location.part === 'footnote')).toMatchObject({ evidence_id: 'f0.d.fn1', text: '각주 HWP-FN' });
			expect(allText(out)).not.toContain('COMMENT-ONLY');
			expect(out.warnings.some((w) => w.includes('숨은 설명(메모) 1개'))).toBe(true);
		},
		T
	);

	it(
		'table rebuilt from LIST_HEADER cell addresses/spans',
		async () => {
			const out = await parse(input(bytes, 'a.hwp'));
			expect(out.tables).toHaveLength(1);
			expect(out.tables[0]).toMatchObject({ table_id: 'f0.d.t0', kind: 'doc_table' });
			expect(grid(out)).toEqual(SAME_TABLE);
			expect(out.tables[0]!.merged_ranges).toEqual(['A2:B2', 'C2:C3']);
			expect(cellAt(out.tables[0]!, 'C2')).toMatchObject({ type: 'string', value: '0042' });
			expectEvidenceConvention(out);
		},
		T
	);

	it(
		'uncompressed variant gives the same content; BinData image OCR',
		async () => {
			const plain = await parse(input(await hwp5({ compressed: false }), 'a.hwp'));
			const comp = await parse(input(bytes, 'a.hwp'));
			expect(plain.texts.filter((t) => t.kind === 'paragraph')).toEqual(comp.texts.filter((t) => t.kind === 'paragraph'));
			expect(plain.tables).toEqual(comp.tables);
			const regions = comp.texts.filter((x) => x.kind === 'region');
			expect(regions.length).toBeGreaterThan(0);
			for (const r of regions) expect(r.evidence_id).toMatch(/^f0\.d\.BIN0001_png\.l\d+$/);
			expect(regions.map((r) => r.text).join(' ')).toContain('4821');
		},
		T
	);

	it(
		'unreliable table structure is kept as text with a warning (no guessed grid)',
		async () => {
			const out = await parse(input(await hwp5({ brokenTable: true }), 'a.hwp'));
			expect(out.tables).toHaveLength(0);
			const tt = out.texts.find((x) => x.location.part === 'table_text')!;
			expect(tt.text).toBe('항목\n코드\n볼트');
			expect(out.warnings.some((w) => w.includes('행/열 구조를 복원하지 못해'))).toBe(true);
		},
		T
	);

	it('password, distribution, corrupted, truncated, missing section and wrong version fail with PARSE_FAILED', async () => {
		expect((await expectAppError(parse(input(await hwp5({ password: true }), 'p.hwp')), 'PARSE_FAILED')).message).toContain('암호가 걸린 한글 파일');
		expect((await expectAppError(parse(input(await hwp5({ distribution: true }), 'd.hwp')), 'PARSE_FAILED')).message).toContain(
			'배포용 한글 문서는 지원하지 않음'
		);
		await expectAppError(parse(input(await hwp5({ corruptSection: true }), 'c.hwp')), 'PARSE_FAILED');
		await expectAppError(parse(input(await hwp5({ truncatedRecords: true }), 't.hwp')), 'PARSE_FAILED');
		await expectAppError(parse(input(await hwp5({ missingSection0: true }), 'm.hwp')), 'PARSE_FAILED');
		await expectAppError(parse(input(await hwp5({ version: 0x04000000 }), 'v.hwp')), 'PARSE_FAILED');
		await expectAppError(parse(input(bytes.subarray(0, 1024), 'trunc.hwp')), 'PARSE_FAILED');
		await expectAppError(parse(input(Buffer.from('garbage, not a hangul document'), 'junk.hwp')), 'PARSE_FAILED');
	});

	it('container decides: hwpx bytes named .hwp and hwp bytes named .hwpx parse as what they are', async () => {
		const a = await parse(input(await hwpx(), 'renamed.hwp', { mimeType: MIME.hwp }));
		expect(a.tables).toHaveLength(1);
		const b = await parse(input(bytes, 'renamed.hwpx', { mimeType: MIME.hwpx }));
		expect(b.tables).toHaveLength(1);
	});
});

describe('hwp 3.x via LibreOffice', () => {
	it(
		'HWP 3.x signature with garbage body fails with PARSE_FAILED (not an empty success)',
		async () => {
			await expectAppError(parse(input(hwp3Garbage(), 'old.hwp')), 'PARSE_FAILED');
		},
		300_000
	);

	// SKIP: no HWP 3.x writer exists in this toolchain — LibreOffice's Hangul filter is import-only
	// (writer_MIZI_Hwp_97 has Flags IMPORT, no export) and no Hancom software is available, so a
	// genuine HWP 3.x fixture cannot be produced. The conversion path is exercised only negatively above.
	it.skip('HWP 3.x document converts through LibreOffice and parses as docx', () => {});
});
