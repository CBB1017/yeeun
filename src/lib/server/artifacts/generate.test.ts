import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import iconv from 'iconv-lite';
import JSZip from 'jszip';
import { parse } from 'csv-parse/sync';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../errors';
import { escapeFormula } from './delimited';
import { exactNumber } from './xlsx';
import { slugify } from './common';
import { generateArtifacts, type ArtifactInput, type GeneratedArtifact, type ResultCell } from './generate';

const T = 240_000;

const s = (v: string): ResultCell => ({ type: 'string', value: v, display: v });
const n = (v: string, display?: string): ResultCell => ({
	type: 'number',
	value: v,
	display: display ?? v
});
const d = (v: string): ResultCell => ({ type: 'date', value: v, display: v });
const empty: ResultCell = { type: 'empty', value: null, display: null };

const HEADERS = ['관리번호', '연구과제명', '마감일', '금액(원)', '비고', '완료'];

function fixture(overrides: Partial<ArtifactInput> = {}): ArtifactInput {
	const cols = HEADERS.map((label, i) => ({
		column_id: String.fromCharCode(65 + i),
		label
	}));
	const row = (id: string, cells: ResultCell[]) => ({
		record_id: id,
		cells: Object.fromEntries(cols.map((c, i) => [c.column_id, cells[i] ?? empty]))
	});
	return {
		title: '연구 마감 정리 2026 Q4',
		summary: '이번 주 마감 연구과제 3건을 정리했습니다. 한글 렌더링 확인용 문장입니다.',
		claims: [
			{ claim_key: 'deadline.count', value: '3', type: 'number', unit: '건' },
			{
				claim_key: 'total.amount',
				value: '1234.5',
				type: 'number',
				unit: '원'
			}
		],
		table: {
			columns: cols,
			rows: [
				row('f0.t0.r2', [
					s('00123'),
					s('인공지능 기반 문서 분석'),
					d('2026-11-05'),
					n('1234.5', '1,234.50'),
					s('첫 줄\n둘째 줄, "인용"'),
					{ type: 'boolean', value: 'true', display: 'TRUE' }
				]),
				row('f0.t0.r3', [
					s('00456'),
					s('=SUM(A1:A9)'),
					d('2026-11-07'),
					n('-12.5'),
					s('+82-10-0000-0000'),
					{ type: 'boolean', value: 'false', display: 'FALSE' }
				]),
				row('f0.t0.r4', [s('007'), s('@cmd'), d('2026-12-01'), n('12345678901234567890'), s('-위험 문자열'), empty]),
				row('f0.t0.r5', [
					s('008'),
					s('\t탭으로 시작'),
					{ type: 'error', value: '#DIV/0!', display: '#DIV/0!' },
					n('0.1'),
					{ type: 'formula_uncomputed', value: null, display: '=B2*2' },
					empty
				])
			]
		},
		versionInfo: [
			{
				name: '연구과제.xlsx',
				sha256: 'a'.repeat(64),
				provider_revision: '42',
				captured_at: '2026-11-02T01:00:00.000Z'
			}
		],
		warnings: ['B열 일부 값은 수식 계산값이 없어 표시값을 사용함'],
		csvEncoding: 'utf-8',
		...overrides
	};
}

function one(arts: GeneratedArtifact[], format: string): GeneratedArtifact {
	const a = arts.filter((x) => x.format === format);
	expect(a).toHaveLength(1);
	return a[0]!;
}

async function savePreview(name: string, png: Buffer) {
	const dirs = ['/tmp/artifact-previews', process.env.ARTIFACT_PREVIEW_DIR].filter(Boolean) as string[];
	for (const dir of dirs) {
		await mkdir(dir, { recursive: true });
		await writeFile(path.join(dir, name), png);
	}
}

describe('helpers', () => {
	it('escapes formula-like text but not plain numbers', () => {
		expect(escapeFormula('=1+1')).toEqual({ text: "'=1+1", escaped: true });
		expect(escapeFormula('+SUM(1)')).toEqual({
			text: "'+SUM(1)",
			escaped: true
		});
		expect(escapeFormula('@x').escaped).toBe(true);
		expect(escapeFormula('\tx').escaped).toBe(true);
		expect(escapeFormula('\rx').escaped).toBe(true);
		expect(escapeFormula('-abc').escaped).toBe(true);
		expect(escapeFormula('-12.5')).toEqual({ text: '-12.5', escaped: false });
		expect(escapeFormula('+3').escaped).toBe(false);
		expect(escapeFormula('1e-5').escaped).toBe(false);
		expect(escapeFormula('a=b').escaped).toBe(false);
	});

	it('keeps numbers only when exactly representable', () => {
		expect(exactNumber('1234.50')).toBe(1234.5);
		expect(exactNumber('-12.5')).toBe(-12.5);
		expect(exactNumber('0.1')).toBe(0.1);
		expect(exactNumber('12345678901234567890')).toBeNull();
		expect(exactNumber('007')).toBeNull();
		expect(exactNumber('1e3')).toBeNull();
	});

	it('builds ASCII-only, path-free filenames', () => {
		expect(slugify('연구 마감 정리 2026 Q4')).toBe('2026-q4');
		expect(slugify('../../etc/passwd')).toBe('etc-passwd');
		expect(slugify('한글만')).toBe('result');
	});
});

describe('generateArtifacts (all formats)', () => {
	const original = Buffer.from('관리번호,연구과제명\r\n00123,원본 파일 바이트\r\n', 'utf-8');
	const originalCopy = Buffer.from(original);
	const originalHash = createHash('sha256').update(original).digest('hex');
	let arts: GeneratedArtifact[];

	beforeAll(async () => {
		arts = await generateArtifacts(
			fixture({
				versionInfo: [
					{
						name: 'source.csv',
						sha256: originalHash,
						provider_revision: null,
						captured_at: '2026-11-02T00:00:00Z'
					}
				]
			}),
			['xlsx', 'pptx', 'pdf', 'csv', 'tsv', 'png', 'jpeg', 'csv']
		);
	}, T);

	it('A18: original bytes are unchanged and every output is a new, validated file', () => {
		expect(createHash('sha256').update(original).digest('hex')).toBe(originalHash);
		expect(original.equals(originalCopy)).toBe(true);
		for (const a of arts) {
			expect(a.validation.reopened).toBe(true);
			expect(a.validation.checks.length).toBeGreaterThan(0);
			expect(a.bytes.length).toBeGreaterThan(0);
			expect(a.bytes.equals(original)).toBe(false);
			expect(a.filename).toMatch(/^[a-z0-9-]+\.(xlsx|pptx|pdf|csv|tsv|png|jpg)$/);
		}
		// duplicate format requests produce one file
		expect(arts.filter((a) => a.format === 'csv')).toHaveLength(1);
	});

	it('csv: RFC-4180, leading zeros, quoted newline, formula escape count + Korean notice', () => {
		const a = one(arts, 'csv');
		expect(a.filename).toBe('2026-q4.csv');
		expect(a.mimeType).toBe('text/csv; charset=utf-8');
		expect(a.bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
		const text = a.bytes.toString('utf-8');
		expect(text.startsWith('관리번호,연구과제명,마감일,금액(원),비고,완료\r\n')).toBe(true);
		expect(text).toContain('"첫 줄\n둘째 줄, ""인용"""');
		const rec = parse(text) as string[][];
		expect(rec[0]).toEqual(HEADERS);
		expect(rec.map((r) => r[0])).toEqual(['관리번호', '00123', '00456', '007', '008']);
		expect(rec[1]![4]).toBe('첫 줄\n둘째 줄, "인용"');
		expect(rec[2]![1]).toBe("'=SUM(A1:A9)");
		expect(rec[2]![3]).toBe('-12.5');
		expect(rec[2]![4]).toBe("'+82-10-0000-0000");
		expect(rec[3]![1]).toBe("'@cmd");
		expect(rec[3]![4]).toBe("'-위험 문자열");
		expect(rec[3]![3]).toBe('12345678901234567890');
		expect(rec[4]![1]).toBe("'\t탭으로 시작");
		expect(rec[4]![4]).toBe("'=B2*2");
		expect(a.validation.formulaInjectionEscaped).toBe(6);
		expect(a.validation.rowCount).toBe(4);
		expect(a.validation.checks.some((c) => c.includes('작은따옴표') && c.includes('원본과 다릅니다'))).toBe(true);
	});

	it('tsv: tab delimited with quoting of embedded tabs/newlines', () => {
		const a = one(arts, 'tsv');
		const rec = parse(a.bytes.toString('utf-8'), {
			delimiter: '\t'
		}) as string[][];
		expect(rec[0]).toEqual(HEADERS);
		expect(rec).toHaveLength(5);
		expect(rec[4]![1]).toBe("'\t탭으로 시작");
		expect(a.validation.formulaInjectionEscaped).toBe(6);
	});

	it('xlsx: exact headers, typed values, no formulas, summary and version sheets', async () => {
		const a = one(arts, 'xlsx');
		const wb = new ExcelJS.Workbook();
		await wb.xlsx.load(a.bytes as unknown as ArrayBuffer);
		expect(wb.worksheets.map((w) => w.name)).toEqual(['결과', '요약', '버전·근거']);
		const ws = wb.getWorksheet('결과')!;
		expect(HEADERS.map((_, i) => ws.getCell(1, i + 1).value)).toEqual(HEADERS);
		expect(ws.getCell(2, 1).value).toBe('00123');
		expect(ws.getCell(2, 3).value).toEqual(new Date(Date.UTC(2026, 10, 5)));
		expect(ws.getCell(2, 4).value).toBe(1234.5);
		expect(ws.getCell(2, 5).value).toBe('첫 줄\n둘째 줄, "인용"');
		expect(ws.getCell(2, 6).value).toBe(true);
		expect(ws.getCell(3, 2).value).toBe('=SUM(A1:A9)');
		expect(ws.getCell(3, 2).type).toBe(ExcelJS.ValueType.String);
		expect(ws.getCell(3, 4).value).toBe(-12.5);
		expect(ws.getCell(4, 4).value).toBe('12345678901234567890');
		expect(ws.getCell(5, 3).value).toBe('#DIV/0!');
		expect(ws.getCell(5, 5).value).toBe('=B2*2');
		ws.eachRow((r) => r.eachCell((c) => expect(c.type).not.toBe(ExcelJS.ValueType.Formula)));
		expect(ws.actualRowCount).toBe(5);
		const summary = wb.getWorksheet('요약')!;
		expect(summary.getCell(2, 2).value).toContain('마감 연구과제 3건');
		const ver = wb.getWorksheet('버전·근거')!;
		expect(ver.getCell(3, 2).value).toBe(createHash('sha256').update(original).digest('hex'));
		expect(a.validation.rowCount).toBe(4);
	});

	it('pdf: reopens, Korean header text present, preview PNG rendered', async () => {
		const a = one(arts, 'pdf');
		expect(a.bytes.subarray(0, 5).toString()).toBe('%PDF-');
		const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
		const task = pdfjs.getDocument({
			data: new Uint8Array(a.bytes),
			verbosity: 0
		});
		const doc = await task.promise;
		expect(doc.numPages).toBeGreaterThan(0);
		const page = await doc.getPage(1);
		const txt = (await page.getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('');
		expect(txt.replace(/\s/g, '')).toContain('연구과제명');
		expect(txt.replace(/\s/g, '')).toContain('00123');
		await task.destroy();
		const png = a.validation.previewPng!;
		const meta = await sharp(png).metadata();
		expect(meta.format).toBe('png');
		expect(meta.width! > 500 && meta.height! > 300).toBe(true);
		expect(png.length).toBeGreaterThan(20_000);
		await savePreview('pdf-preview.png', png);
	});

	it('pptx: title + paginated table slides, Korean font, preview PNG rendered', async () => {
		const a = one(arts, 'pptx');
		const zip = await JSZip.loadAsync(a.bytes);
		const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
		// title + 1 table slide (4 rows) + claims + versions
		expect(slides).toHaveLength(4);
		const s2 = await zip.file('ppt/slides/slide2.xml')!.async('string');
		for (const h of HEADERS) expect(s2).toContain(h);
		expect(s2).toContain('Noto Sans CJK KR');
		expect(a.validation.rowCount).toBe(4);
		const png = a.validation.previewPng!;
		const meta = await sharp(png).metadata();
		expect(meta.width! > 500).toBe(true);
		expect(png.length).toBeGreaterThan(10_000);
		await savePreview('pptx-preview.png', png);
	});

	it('png/jpeg: one image per rendered page, readable by sharp', async () => {
		for (const f of ['png', 'jpeg'] as const) {
			const imgs = arts.filter((a) => a.format === f);
			expect(imgs.length).toBeGreaterThan(0);
			for (const img of imgs) {
				const meta = await sharp(img.bytes).metadata();
				expect(meta.format).toBe(f);
				expect(meta.width! > 0 && meta.height! > 0).toBe(true);
				expect(img.mimeType).toBe(f === 'png' ? 'image/png' : 'image/jpeg');
			}
			if (imgs.length > 1) expect(imgs[0]!.filename).toMatch(/-p0?1\./);
		}
		await savePreview('page1.jpg', arts.find((a) => a.format === 'jpeg')!.bytes);
	});
});

describe('generateArtifacts (encodings and edge cases)', () => {
	it('csv cp949 round trip and utf-8 BOM', async () => {
		const [cp] = await generateArtifacts(fixture({ csvEncoding: 'cp949' }), ['csv']);
		expect(cp!.mimeType).toBe('text/csv; charset=euc-kr');
		expect(() => new TextDecoder('utf-8', { fatal: true }).decode(cp!.bytes)).toThrow();
		const rec = parse(iconv.decode(cp!.bytes, 'cp949')) as string[][];
		expect(rec[0]).toEqual(HEADERS);
		expect(rec[1]![0]).toBe('00123');
		expect(rec[1]![4]).toBe('첫 줄\n둘째 줄, "인용"');
		expect(cp!.validation.checks[0]).toContain('cp949');

		const [bom] = await generateArtifacts(fixture({ csvEncoding: 'utf-8-bom' }), ['tsv']);
		expect([...bom!.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
		expect(bom!.bytes.subarray(3).toString('utf-8').startsWith(HEADERS.join('\t'))).toBe(true);
	});

	it('cp949 refuses characters it cannot encode instead of writing "?"', async () => {
		const input = fixture({ csvEncoding: 'cp949' });
		input.table!.rows[0]!.cells['B'] = s('이모지 😀');
		const err = await generateArtifacts(input, ['csv']).catch((e) => e);
		expect(err).toBeInstanceOf(AppError);
		expect((err as AppError).code).toBe('EXECUTION_FAILED');
		expect((err as AppError).message).toContain('CP949');
	});

	it('xlsx: XML-illegal control characters are replaced and reported, CSV keeps them', async () => {
		const input = fixture();
		input.table!.rows[0]!.cells['B'] = s('제어\u0001문자');
		const [x, c] = await generateArtifacts(input, ['xlsx', 'csv']);
		const wb = new ExcelJS.Workbook();
		await wb.xlsx.load(x!.bytes as unknown as ArrayBuffer);
		expect(wb.getWorksheet('결과')!.getCell(2, 2).value).toBe('제어�문자');
		expect(x!.validation.checks.some((m) => m.includes('제어문자 1개'))).toBe(true);
		expect((parse(c!.bytes.toString('utf-8')) as string[][])[1]![1]).toBe('제어\u0001문자');
	});

	it(
		'empty table (0 rows) in every format keeps the header',
		async () => {
			const input = fixture({ csvEncoding: 'utf-8' });
			input.table!.rows = [];
			const arts = await generateArtifacts(input, ['xlsx', 'csv', 'tsv', 'pdf', 'pptx', 'png']);
			expect(one(arts, 'csv').bytes.toString('utf-8')).toBe(HEADERS.join(',') + '\r\n');
			expect(one(arts, 'csv').validation.rowCount).toBe(0);
			expect(one(arts, 'tsv').validation.rowCount).toBe(0);
			expect(one(arts, 'xlsx').validation.rowCount).toBe(0);
			expect(one(arts, 'pptx').validation.rowCount).toBe(0);
			expect(one(arts, 'pdf').validation.previewPng!.length).toBeGreaterThan(5000);
			expect(arts.filter((a) => a.format === 'png').length).toBeGreaterThan(0);
		},
		T
	);

	it(
		'no table: claims become the table; many rows paginate pptx and split images per page',
		async () => {
			const noTable = await generateArtifacts(fixture({ table: null }), ['csv']);
			const rec = parse(noTable[0]!.bytes.toString('utf-8')) as string[][];
			expect(rec[0]).toEqual(['claim_key', 'value', 'type', 'unit']);
			expect(rec).toHaveLength(3);

			const input = fixture();
			const base = input.table!.rows[0]!;
			input.table!.rows = Array.from({ length: 70 }, (_, i) => ({
				record_id: `r${i}`,
				cells: { ...base.cells, A: s(String(i).padStart(5, '0')) }
			}));
			const arts = await generateArtifacts(input, ['pptx', 'png']);
			const p = one(arts, 'pptx');
			const zip = await JSZip.loadAsync(p.bytes);
			const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
			expect(slides).toHaveLength(1 + Math.ceil(70 / 12) + 1 + 1);
			expect(p.validation.rowCount).toBe(70);
			const pngs = arts.filter((a) => a.format === 'png');
			expect(pngs.length).toBeGreaterThan(1);
			expect(pngs.map((a) => a.filename)).toEqual(pngs.map((_, i) => `2026-q4-p${i + 1}.png`));
		},
		T
	);
});
