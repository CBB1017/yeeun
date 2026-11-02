import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../errors';
import { run, toolAvailable, withTempDir } from './exec';
import { parseXlsx } from './xlsx';
import { parseDelimited } from './csv';
import { parsePdf } from './pdf';
import { parsePptx } from './pptx';
import { isEncryptedOoxml, parseDocx } from './docx';
import { parseHwpx } from './hwpx';
import { hangulVariant, HWP3_SIGNATURE, parseHwp5 } from './hwp';
import { ocrImage } from './ocr';
import { kindOf, type ParseInput, type ParseOutput } from './types';

const CFB_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const LEGACY_IMPORT_FILTERS: Record<string, string> = {
	xls: 'MS Excel 97',
	ppt: 'MS PowerPoint 97',
	doc: 'MS Word 97',
	// LibreOffice's Hangul filter (hwpfilter) reads HWP 3.x only; HWP 5.x is parsed natively.
	hwp: 'writer_MIZI_Hwp_97'
};
/** Container signature each forced import filter requires. */
const LEGACY_SIGNATURES: Record<string, Buffer> = { xls: CFB_SIGNATURE, ppt: CFB_SIGNATURE, doc: CFB_SIGNATURE, hwp: HWP3_SIGNATURE };

/**
 * Convert legacy binary Office files with an isolated, headless LibreOffice
 * profile (fresh per call, no macros, no network link updates).
 */
export async function convertWithLibreOffice(bytes: Buffer, fromExt: string, toExt: string): Promise<Buffer> {
	// Legacy Office binaries are OLE/CFB containers. Without this check (and a forced
	// import filter) LibreOffice falls back to its text/CSV import and "converts"
	// corrupted or foreign bytes into a bogus spreadsheet/presentation.
	const infilter = LEGACY_IMPORT_FILTERS[fromExt];
	const sig = LEGACY_SIGNATURES[fromExt];
	if (infilter && sig && !bytes.subarray(0, sig.length).equals(sig)) {
		throw new AppError('PARSE_FAILED', `${fromExt} 파일 형식이 아님 (손상되었거나 다른 형식)`, 'preparing');
	}
	if (!(await toolAvailable('soffice'))) {
		throw new AppError('CAPABILITY_UNAVAILABLE', 'LibreOffice가 이 컨테이너에 없어 변환할 수 없음', 'preparing');
	}
	return withTempDir(async (dir) => {
		const inPath = path.join(dir, `input.${fromExt}`);
		await writeFile(inPath, bytes);
		const profile = path.join(dir, 'profile');
		const r = await run(
			'soffice',
			[
				`-env:UserInstallation=file://${profile}`,
				'--headless',
				'--norestore',
				'--nolockcheck',
				'--nodefault',
				...(infilter ? [`--infilter=${infilter}`] : []),
				'--convert-to',
				toExt,
				'--outdir',
				path.join(dir, 'out'),
				inPath
			],
			{ timeoutMs: 180_000, cwd: dir, env: { PATH: process.env.PATH, HOME: dir, LANG: 'C.UTF-8' } }
		);
		const outDir = path.join(dir, 'out');
		const files = await readdir(outDir).catch(() => [] as string[]);
		const produced = files.find((f) => f.toLowerCase().endsWith(`.${toExt.split(':')[0]}`));
		if (r.code !== 0 || !produced) {
			throw new AppError('PARSE_FAILED', `변환 실패 (손상/암호화 가능): ${fromExt} → ${toExt}`, 'preparing');
		}
		return readFile(path.join(outDir, produced));
	});
}

export async function parseSource(input: ParseInput): Promise<ParseOutput> {
	const kind = kindOf(input.mimeType, input.name);
	switch (kind) {
		case 'xlsx':
			return parseXlsx(input);
		case 'xls': {
			const x = await convertWithLibreOffice(input.bytes, 'xls', 'xlsx');
			const out = await parseXlsx({ ...input, bytes: x });
			out.warnings.unshift('구형 xls를 격리된 LibreOffice로 xlsx 변환 후 분석');
			return out;
		}
		case 'pptx':
			return parsePptx(input);
		case 'ppt': {
			const x = await convertWithLibreOffice(input.bytes, 'ppt', 'pptx');
			const out = await parsePptx({ ...input, bytes: x });
			out.warnings.unshift('구형 ppt를 격리된 LibreOffice로 pptx 변환 후 분석');
			return out;
		}
		case 'docx':
		case 'doc':
			return parseWord(input);
		case 'hwpx':
		case 'hwp':
			return parseHangul(input);
		case 'pdf':
			return parsePdf(input);
		case 'csv':
			return parseDelimited(input, ',');
		case 'tsv':
			return parseDelimited(input, '\t');
		case 'image': {
			const r = await ocrImage(input.bytes, input.fileIndex, input.ocrBudget, input.maxOcrPages);
			return { tables: [], texts: r.texts, warnings: r.warnings };
		}
		default:
			throw new AppError('UNSUPPORTED_FORMAT', `지원하지 않는 파일 형식: ${input.mimeType}`, 'preparing');
	}
}

/**
 * Word: the container decides (a .doc that is really OOXML, or the reverse, is
 * parsed by what it is). Legacy .doc goes through the isolated LibreOffice.
 */
async function parseWord(input: ParseInput): Promise<ParseOutput> {
	const head = input.bytes.subarray(0, 8);
	if (head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return parseDocx(input);
	if (!head.equals(CFB_SIGNATURE)) throw new AppError('PARSE_FAILED', 'Word 파일 형식이 아님 (손상되었거나 다른 형식)', 'preparing');
	if (isEncryptedOoxml(input.bytes)) return parseDocx(input); // reports the encrypted-file error
	const x = await convertWithLibreOffice(input.bytes, 'doc', 'docx');
	const out = await parseDocx({ ...input, bytes: x });
	out.warnings.unshift('구형 doc을 격리된 LibreOffice로 docx 변환 후 분석');
	return out;
}

/** Hangul: HWP 5.x (CFB) and HWPX (zip) natively; HWP 3.x via the isolated LibreOffice hwp filter. */
async function parseHangul(input: ParseInput): Promise<ParseOutput> {
	switch (hangulVariant(input.bytes)) {
		case 'hwpx':
			return parseHwpx(input);
		case 'hwp5':
			return parseHwp5(input);
		case 'hwp3': {
			const x = await convertWithLibreOffice(input.bytes, 'hwp', 'docx');
			const out = await parseDocx({ ...input, bytes: x });
			if (!out.texts.length && !out.tables.length) {
				throw new AppError('PARSE_FAILED', '구형 한글(HWP 3.x) 문서 변환 결과가 비어 있음 (손상 가능)', 'preparing');
			}
			out.warnings.unshift('구형 한글(HWP 3.x) 문서를 격리된 LibreOffice로 docx 변환 후 분석');
			return out;
		}
		default:
			throw new AppError('PARSE_FAILED', '한글 파일 형식이 아님 (손상되었거나 지원하지 않는 버전)', 'preparing');
	}
}

export { EXTRACTION_VERSION, kindOf, GOOGLE_EXPORTS, MIME } from './types';
