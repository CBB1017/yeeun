import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import iconv from 'iconv-lite';
import { acceptSingle, cleanDisplayName, cleanEntryPath, contentMatches, decodeZipName, unpackZip } from './inspect';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n');
const CSV = Buffer.from('이름,마감일\n과제,2026-11-30\n');

async function xlsxLike(): Promise<Buffer> {
	const z = new JSZip();
	z.file('[Content_Types].xml', '<Types/>');
	return z.generateAsync({ type: 'nodebuffer' });
}

async function zipOf(entries: Record<string, Buffer | string>): Promise<Buffer> {
	const z = new JSZip();
	for (const [name, data] of Object.entries(entries)) z.file(name, data);
	return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const LIMITS = { maxFileBytes: 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024, maxFiles: 10 };

describe('upload display names', () => {
	it('keeps only the base name, NFC-normalised and without control characters', () => {
		expect(cleanDisplayName('C:\\Users\\me\\보고서.xlsx')).toBe('보고서.xlsx');
		expect(cleanDisplayName('../../etc/passwd.csv')).toBe('passwd.csv');
		expect(cleanDisplayName('a\u0000b\u001f.pdf')).toBe('ab.pdf');
		expect(cleanDisplayName('\u1100\u1161.csv')).toBe('가.csv'); // NFD (macOS) -> NFC
		expect(() => cleanDisplayName('/')).toThrow();
	});

	it('cleans ZIP entry paths for display without dot segments', () => {
		expect(cleanEntryPath('./자료/../2026/매출.xlsx')).toBe('자료/2026/매출.xlsx');
		expect(cleanEntryPath('dir\\sub\\a.csv')).toBe('dir/sub/a.csv');
	});

	it('reads non-UTF-8 ZIP names as CP949 (Windows Explorer) and keeps valid UTF-8', () => {
		expect(decodeZipName(iconv.encode('연구과제 목록.xlsx', 'cp949'))).toBe('연구과제 목록.xlsx');
		expect(decodeZipName(Buffer.from('연구과제.xlsx', 'utf8'))).toBe('연구과제.xlsx');
	});
});

describe('extension and content agreement', () => {
	it('accepts matching signatures and refuses renamed files', async () => {
		expect(contentMatches('png', PNG)).toBe(true);
		expect(contentMatches('pdf', PDF)).toBe(true);
		expect(contentMatches('csv', CSV)).toBe(true);
		expect(contentMatches('xlsx', await xlsxLike())).toBe(true);
		expect(contentMatches('xlsx', PDF)).toBe(false);
		expect(contentMatches('csv', PNG)).toBe(false); // binary renamed to .csv
		expect(contentMatches('jpg', PNG)).toBe(false);
	});

	it('acceptSingle: type, emptiness, size and signature checks', () => {
		expect(acceptSingle('a.csv', CSV, 1000).mime).toBe('text/csv');
		expect(acceptSingle('사진.JPG', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 1000).mime).toBe('image/jpeg');
		expect(() => acceptSingle('a.docx', CSV, 1000)).toThrow(/첨부할 수 없는 형식/);
		expect(() => acceptSingle('a.exe', CSV, 1000)).toThrow(/첨부할 수 없는 형식/);
		expect(() => acceptSingle('a.csv', Buffer.alloc(0), 1000)).toThrow(/빈 파일/);
		expect(() => acceptSingle('a.csv', CSV, 10)).toThrow(/크기 한도/);
		expect(() => acceptSingle('a.pdf', PNG, 1000)).toThrow(/형식이 아닙니다/);
	});
});

describe('ZIP unpacking', () => {
	it('unpacks analysable files and lists every other entry with a reason', async () => {
		const zip = await zipOf({
			'자료/매출.xlsx': await xlsxLike(),
			'자료/요약.pdf': PDF,
			'메모.docx': 'not supported',
			'안쪽.zip': await zipOf({ 'x.csv': CSV }),
			'__MACOSX/자료/._매출.xlsx': 'apple',
			'.DS_Store': 'x',
			'가짜.png': CSV,
			'빈.csv': '',
			'큰.csv': Buffer.alloc(LIMITS.maxFileBytes + 1, 0x41)
		});
		const r = await unpackZip('업무자료.zip', zip, LIMITS);
		expect(r.files.map((f) => f.name)).toEqual(['자료/매출.xlsx', '자료/요약.pdf']);
		expect(r.files.every((f) => f.archiveName === '업무자료.zip')).toBe(true);
		expect(Object.fromEntries(r.skipped.map((s) => [s.name, s.reason]))).toEqual({
			'메모.docx': 'unsupported',
			'안쪽.zip': 'nested_archive',
			'__MACOSX/자료/._매출.xlsx': 'system_file',
			'.DS_Store': 'system_file',
			'가짜.png': 'content_mismatch',
			'빈.csv': 'empty',
			'큰.csv': 'too_large'
		});
	});

	it('measures real decompressed size: a highly compressible entry over the limit is skipped, not inflated fully', async () => {
		const bomb = await zipOf({ 'ok.csv': CSV, 'bomb.csv': Buffer.alloc(50 * 1024 * 1024, 0x30) });
		expect(bomb.length).toBeLessThan(1024 * 1024);
		const r = await unpackZip('b.zip', bomb, LIMITS);
		expect(r.files.map((f) => f.name)).toEqual(['ok.csv']);
		expect(r.skipped).toEqual([{ name: 'bomb.csv', reason: 'too_large' }]);
	});

	it('refuses the whole archive when the unpacked total exceeds the limit', async () => {
		const big = Buffer.alloc(900 * 1024, 0x31);
		const zip = await zipOf({ 'a.csv': big, 'b.csv': big, 'c.csv': big });
		await expect(unpackZip('t.zip', zip, { ...LIMITS, maxTotalBytes: 2 * 1024 * 1024 })).rejects.toThrow(/푼 크기가 한도/);
	});

	it('refuses more analysable files than one request can use', async () => {
		const entries: Record<string, Buffer> = {};
		for (let i = 0; i < 11; i++) entries[`f${i}.csv`] = CSV;
		await expect(unpackZip('many.zip', await zipOf(entries), LIMITS)).rejects.toThrow(/최대 10개/);
	});

	it('refuses an archive with nothing to analyse, corrupt data and non-ZIP bytes', async () => {
		await expect(unpackZip('docs.zip', await zipOf({ 'a.docx': 'x', 'b.hwp': 'y' }), LIMITS)).rejects.toThrow(/분석할 수 있는 파일이 없습니다/);
		const good = await zipOf({ 'a.csv': CSV });
		const corrupt = Buffer.concat([good.subarray(0, 30), Buffer.alloc(20, 0xff), good.subarray(50)]);
		await expect(unpackZip('c.zip', corrupt, LIMITS)).rejects.toThrow(/zip/);
		await expect(unpackZip('n.zip', PDF, LIMITS)).rejects.toThrow(/zip 파일이 아닙니다/);
	});
});
