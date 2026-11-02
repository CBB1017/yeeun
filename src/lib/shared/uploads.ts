/**
 * Files a user may attach from their PC to a request. Shared by the upload API
 * and the request box. ZIP archives are unpacked on upload; each supported file
 * inside becomes its own retained original.
 */

export const UPLOAD_MIME: Record<string, string> = {
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
	xls: 'application/vnd.ms-excel',
	pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	ppt: 'application/vnd.ms-powerpoint',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	docm: 'application/vnd.ms-word.document.macroEnabled.12',
	doc: 'application/msword',
	hwpx: 'application/hwp+zip',
	hwp: 'application/x-hwp',
	pdf: 'application/pdf',
	csv: 'text/csv',
	tsv: 'text/tab-separated-values',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp'
};

/** Extensions the parsers can analyse (also allowed inside a ZIP). */
export const ANALYSABLE_EXTENSIONS = Object.keys(UPLOAD_MIME);
/** Extensions accepted by the upload API. */
export const UPLOAD_EXTENSIONS = [...ANALYSABLE_EXTENSIONS, 'zip'];
/** Value for `<input type="file" accept>`. */
export const UPLOAD_ACCEPT = UPLOAD_EXTENSIONS.map((e) => `.${e}`).join(',');
/** A request can use at most this many files (same as the plan's source limit). */
export const MAX_ATTACHMENTS = 10;

export function extensionOf(name: string): string {
	const base = name.split(/[\\/]/).pop() ?? '';
	const dot = base.lastIndexOf('.');
	return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export type SkipReason = 'unsupported' | 'too_large' | 'nested_archive' | 'system_file' | 'content_mismatch' | 'empty';

export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
	unsupported: '지원하지 않는 형식',
	too_large: '파일 크기 한도 초과',
	nested_archive: 'zip 안의 압축 파일은 풀지 않음',
	system_file: '운영체제가 만든 부가 파일',
	content_mismatch: '확장자와 내용이 맞지 않음',
	empty: '빈 파일'
};

export interface UploadedOriginal {
	id: string;
	displayName: string;
	mimeType: string;
	sizeBytes: number;
	sha256: string;
	archiveName: string | null;
	createdAt: string;
}

export interface SkippedEntry {
	name: string;
	reason: SkipReason;
}

export interface UploadResult {
	files: UploadedOriginal[];
	skipped: SkippedEntry[];
}

export interface UploadLimits {
	maxFileBytes: number;
	maxArchiveTotalBytes: number;
	maxAttachments: number;
	extensions: string[];
}
