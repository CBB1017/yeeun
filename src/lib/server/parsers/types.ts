import type { SourceSelector } from '../../shared/plan';
import type { Cell, Table, TextBlock } from '../../shared/manifest';
import { parseStrictDate } from '../checks/dates';

export const EXTRACTION_VERSION = 'yeeun-extract/1';

export interface ParseInput {
	bytes: Buffer;
	mimeType: string;
	name: string;
	fileIndex: number;
	selector: SourceSelector;
	maxOcrPages: number;
	/** Pages OCR'd so far in this run (shared budget). */
	ocrBudget: { used: number };
}

export interface ParseOutput {
	tables: Table[];
	texts: TextBlock[];
	warnings: string[];
}

export function colLetter(n: number): string {
	let s = '';
	while (n > 0) {
		const m = (n - 1) % 26;
		s = String.fromCharCode(65 + m) + s;
		n = Math.floor((n - 1) / 26);
	}
	return s;
}

/** Infer a typed cell from raw text (CSV, OCR'd tables). Leading zeros stay text. */
export function typedFromText(text: string, columnId: string, evidenceId: string): Cell {
	const t = text;
	if (t.trim() === '') {
		return { column_id: columnId, evidence_id: evidenceId, type: 'empty', value: null, display: '', formula: null };
	}
	const trimmed = t.trim();
	if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(trimmed)) {
		return { column_id: columnId, evidence_id: evidenceId, type: 'number', value: trimmed, display: t, formula: null };
	}
	const d = parseStrictDate(trimmed);
	if (d) return { column_id: columnId, evidence_id: evidenceId, type: 'date', value: d, display: t, formula: null };
	if (/^(true|false)$/i.test(trimmed)) {
		return { column_id: columnId, evidence_id: evidenceId, type: 'boolean', value: trimmed.toLowerCase(), display: t, formula: null };
	}
	return { column_id: columnId, evidence_id: evidenceId, type: 'string', value: t, display: t, formula: null };
}

export const MIME = {
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
	xls: 'application/vnd.ms-excel',
	pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	ppt: 'application/vnd.ms-powerpoint',
	pdf: 'application/pdf',
	csv: 'text/csv',
	tsv: 'text/tab-separated-values',
	png: 'image/png',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gsheet: 'application/vnd.google-apps.spreadsheet',
	gslides: 'application/vnd.google-apps.presentation',
	gdoc: 'application/vnd.google-apps.document'
} as const;

/** Google native types are exported to these Office/PDF formats before parsing. */
export const GOOGLE_EXPORTS: Record<string, { mime: string; format: string }> = {
	[MIME.gsheet]: { mime: MIME.xlsx, format: 'xlsx' },
	[MIME.gslides]: { mime: MIME.pptx, format: 'pptx' },
	[MIME.gdoc]: { mime: MIME.pdf, format: 'pdf' }
};

export type Kind = 'xlsx' | 'xls' | 'pptx' | 'ppt' | 'pdf' | 'csv' | 'tsv' | 'image';

export function kindOf(mimeType: string, name: string): Kind | null {
	const ext = name.toLowerCase().split('.').pop() ?? '';
	if (mimeType === MIME.xlsx || mimeType === MIME.xlsm || ext === 'xlsx' || ext === 'xlsm') return 'xlsx';
	if (mimeType === MIME.xls || ext === 'xls') return 'xls';
	if (mimeType === MIME.pptx || ext === 'pptx') return 'pptx';
	if (mimeType === MIME.ppt || ext === 'ppt') return 'ppt';
	if (mimeType === MIME.pdf || ext === 'pdf') return 'pdf';
	if (mimeType === MIME.tsv || ext === 'tsv') return 'tsv';
	if (mimeType === MIME.csv || ext === 'csv') return 'csv';
	if (['image/png', 'image/jpeg', 'image/webp'].includes(mimeType) || ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'image';
	return null;
}
