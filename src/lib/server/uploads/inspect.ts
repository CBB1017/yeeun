import JSZip from 'jszip';
import iconv from 'iconv-lite';
import { AppError } from '../errors';
import { ANALYSABLE_EXTENSIONS, UPLOAD_EXTENSIONS, UPLOAD_MIME, extensionOf, type SkippedEntry } from '../../shared/uploads';

/**
 * Pure checks for files attached from the user's PC (no DB, no disk):
 * display-name cleanup, extension/content agreement and ZIP unpacking with
 * entry-count, per-file and total-size limits measured on the real
 * decompressed bytes (declared sizes are not trusted).
 */

export interface AcceptedFile {
	/** Display name only; never used as a path segment. */
	name: string;
	ext: string;
	mime: string;
	bytes: Buffer;
	/** Original ZIP name when the file came out of an archive. */
	archiveName: string | null;
}

export interface ZipLimits {
	maxFileBytes: number;
	maxTotalBytes: number;
	maxFiles: number;
	/** Entries (files + folders) an archive may list at all. */
	maxEntries?: number;
}

const SYSTEM_FILES = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$|\._)/i;

/** Clean a browser-supplied file name for display: basename, NFC, no control chars, bounded length. */
export function cleanDisplayName(raw: string): string {
	const base = (raw.split(/[\\/]/).pop() ?? '').normalize('NFC');
	// eslint-disable-next-line no-control-regex
	const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
	if (!clean || clean === '.' || clean === '..') throw new AppError('VALIDATION_FAILED', '파일 이름이 비어 있습니다');
	if (clean.length > 255) {
		const ext = extensionOf(clean);
		return `${clean.slice(0, 240)}${ext ? `….${ext}` : '…'}`;
	}
	return clean;
}

/** Clean a path inside a ZIP for display ("폴더/파일.xlsx"). */
export function cleanEntryPath(raw: string): string {
	const parts = raw
		.normalize('NFC')
		.replace(/\\/g, '/')
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f]/g, '')
		.split('/')
		.map((p) => p.trim())
		.filter((p) => p && p !== '.' && p !== '..');
	const joined = parts.join('/');
	return joined.length > 500 ? `…${joined.slice(-499)}` : joined;
}

const PK = Buffer.from([0x50, 0x4b]);
const CFB = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** Does the content look like the extension claims? Text formats only need to be free of NUL bytes. */
export function contentMatches(ext: string, b: Buffer): boolean {
	switch (ext) {
		case 'xlsx':
		case 'xlsm':
		case 'pptx':
		case 'zip':
			return b.length >= 4 && b.subarray(0, 2).equals(PK) && [0x0304, 0x0506, 0x0708].includes(b.readUInt16BE(2));
		case 'xls':
		case 'ppt':
			return b.subarray(0, 8).equals(CFB);
		case 'pdf':
			return b.subarray(0, 1024).includes('%PDF-');
		case 'png':
			return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
		case 'jpg':
		case 'jpeg':
			return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
		case 'webp':
			return b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
		case 'csv':
		case 'tsv':
			return !b.subarray(0, 64 * 1024).includes(0);
		default:
			return false;
	}
}

/**
 * ZIP entry names without the UTF-8 flag: valid UTF-8 (macOS, most tools) is
 * kept, anything else is read as CP949 (Windows Explorer on Korean systems).
 */
export function decodeZipName(bytes: Uint8Array | string[] | Buffer): string {
	const buf = Buffer.from(bytes as Uint8Array);
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(buf);
	} catch {
		return iconv.decode(buf, 'cp949');
	}
}

/** Validate a single (non-ZIP) file. */
export function acceptSingle(rawName: string, bytes: Buffer, maxFileBytes: number): AcceptedFile {
	const name = cleanDisplayName(rawName);
	const ext = extensionOf(name);
	if (!UPLOAD_EXTENSIONS.includes(ext) || ext === 'zip')
		throw new AppError('UNSUPPORTED_FORMAT', `"${name}"은(는) 첨부할 수 없는 형식입니다 (허용: ${UPLOAD_EXTENSIONS.join(', ')})`);
	if (bytes.length === 0) throw new AppError('VALIDATION_FAILED', `"${name}"은(는) 빈 파일입니다`);
	if (bytes.length > maxFileBytes) throw new AppError('SOURCE_TOO_LARGE', `"${name}"이(가) 파일 크기 한도(${fmtBytes(maxFileBytes)})를 넘습니다`);
	if (!contentMatches(ext, bytes))
		throw new AppError('UNSUPPORTED_FORMAT', `"${name}"의 내용이 .${ext} 형식이 아닙니다 (손상되었거나 확장자가 바뀐 파일)`);
	return { name, ext, mime: UPLOAD_MIME[ext]!, bytes, archiveName: null };
}

/** Read one ZIP entry, stopping as soon as it exceeds `limit` bytes. Returns null when over the limit. */
async function readEntryLimited(entry: JSZip.JSZipObject, limit: number): Promise<Buffer | null> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		let done = false;
		const stream = entry.nodeStream('nodebuffer');
		stream.on('data', (c: Buffer) => {
			if (done) return;
			size += c.length;
			if (size > limit) {
				done = true;
				(stream as unknown as { pause(): void }).pause();
				resolve(null);
				return;
			}
			chunks.push(c);
		});
		stream.on('error', (e: Error) => {
			if (!done) {
				done = true;
				reject(e);
			}
		});
		stream.on('end', () => {
			if (!done) {
				done = true;
				resolve(Buffer.concat(chunks));
			}
		});
	});
}

/**
 * Unpack a ZIP into individual files. Unsupported or oversized entries are
 * listed in `skipped` with a reason (never dropped silently). The whole
 * archive is refused when it is encrypted/corrupt, has too many entries,
 * exceeds the total size limit, has more analysable files than a request can
 * use, or contains no analysable file at all.
 */
export async function unpackZip(rawName: string, bytes: Buffer, limits: ZipLimits): Promise<{ files: AcceptedFile[]; skipped: SkippedEntry[] }> {
	const archiveName = cleanDisplayName(rawName);
	if (!contentMatches('zip', bytes)) throw new AppError('UNSUPPORTED_FORMAT', `"${archiveName}"은(는) zip 파일이 아닙니다`);
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(bytes, { checkCRC32: true, decodeFileName: decodeZipName });
	} catch (e) {
		const msg = String((e as Error)?.message ?? e);
		throw new AppError(
			'UNSUPPORTED_FORMAT',
			/encrypt/i.test(msg) ? `"${archiveName}"은(는) 암호가 걸린 zip이라 열 수 없습니다` : `"${archiveName}"을(를) 열 수 없습니다 (손상된 zip)`
		);
	}
	const entries = Object.values(zip.files);
	if (entries.length > (limits.maxEntries ?? 2000))
		throw new AppError('SOURCE_TOO_LARGE', `"${archiveName}" 안의 항목이 너무 많습니다 (${entries.length}개)`);

	const files: AcceptedFile[] = [];
	const skipped: SkippedEntry[] = [];
	let total = 0;
	const sorted = entries.filter((e) => !e.dir).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	for (const entry of sorted) {
		const path = cleanEntryPath(entry.name);
		if (!path) continue;
		if (SYSTEM_FILES.test(entry.name.replace(/\\/g, '/'))) {
			skipped.push({ name: path, reason: 'system_file' });
			continue;
		}
		const ext = extensionOf(path);
		if (ext === 'zip' || ext === '7z' || ext === 'rar' || ext === 'gz' || ext === 'tar') {
			skipped.push({ name: path, reason: 'nested_archive' });
			continue;
		}
		if (!ANALYSABLE_EXTENSIONS.includes(ext)) {
			skipped.push({ name: path, reason: 'unsupported' });
			continue;
		}
		let data: Buffer | null;
		try {
			data = await readEntryLimited(entry, limits.maxFileBytes);
		} catch {
			throw new AppError('UNSUPPORTED_FORMAT', `"${archiveName}" 안의 "${path}"을(를) 풀 수 없습니다 (손상된 zip)`);
		}
		if (data === null) {
			skipped.push({ name: path, reason: 'too_large' });
			continue;
		}
		if (data.length === 0) {
			skipped.push({ name: path, reason: 'empty' });
			continue;
		}
		if (!contentMatches(ext, data)) {
			skipped.push({ name: path, reason: 'content_mismatch' });
			continue;
		}
		total += data.length;
		if (total > limits.maxTotalBytes)
			throw new AppError('SOURCE_TOO_LARGE', `"${archiveName}"을(를) 푼 크기가 한도(${fmtBytes(limits.maxTotalBytes)})를 넘습니다`);
		files.push({ name: path, ext, mime: UPLOAD_MIME[ext]!, bytes: data, archiveName });
		if (files.length > limits.maxFiles)
			throw new AppError(
				'VALIDATION_FAILED',
				`"${archiveName}" 안에 분석할 파일이 ${limits.maxFiles}개를 넘습니다. 한 요청에는 최대 ${limits.maxFiles}개까지 사용할 수 있으니 필요한 파일만 담아 다시 첨부하세요.`
			);
	}
	if (files.length === 0)
		throw new AppError('UNSUPPORTED_FORMAT', `"${archiveName}" 안에 분석할 수 있는 파일이 없습니다`, null, { skipped });
	return { files, skipped };
}

export function fmtBytes(n: number): string {
	if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1).replace(/\.0$/, '')}GB`;
	if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1).replace(/\.0$/, '')}MB`;
	if (n >= 1024) return `${Math.round(n / 1024)}KB`;
	return `${n}B`;
}
