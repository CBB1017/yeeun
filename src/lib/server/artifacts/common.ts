import { AppError } from '../errors';
import type { ArtifactInput, ResultCell, ResultTable } from './generate';

export const STAGE = 'finalizing';
export const KOREAN_FONT = 'Noto Sans CJK KR';

export function fail(message: string): never {
	throw new AppError('EXECUTION_FAILED', message, STAGE);
}

/** ASCII-only, path-free file stem derived from the title. */
export function slugify(title: string): string {
	const s = title
		.normalize('NFKD')
		.replace(/[^A-Za-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.toLowerCase()
		.slice(0, 60)
		.replace(/-+$/g, '');
	return s || 'result';
}

/** Text form of a cell as it is written into text outputs (CSV/TSV/PDF/PPTX). */
export function cellText(c: ResultCell | undefined): string {
	if (!c || c.type === 'empty') return '';
	return c.value ?? c.display ?? '';
}

/** Display form for human-oriented outputs (PDF/PPTX): keeps source display formatting when present. */
export function cellDisplay(c: ResultCell | undefined): string {
	if (!c || c.type === 'empty') return '';
	return c.display ?? c.value ?? '';
}

/** The table that is actually written: the result table, or claims as a table when no table exists. */
export function effectiveTable(input: ArtifactInput): ResultTable {
	if (input.table && input.table.columns.length > 0) return input.table;
	const columns = [
		{ column_id: 'claim_key', label: 'claim_key' },
		{ column_id: 'value', label: 'value' },
		{ column_id: 'type', label: 'type' },
		{ column_id: 'unit', label: 'unit' }
	];
	return {
		columns,
		rows: input.claims.map((c, i) => ({
			record_id: `claim.${i + 1}`,
			cells: {
				claim_key: { type: 'string', value: c.claim_key, display: c.claim_key },
				value: { type: 'string', value: c.value, display: c.value },
				type: { type: 'string', value: c.type, display: c.type },
				unit: c.unit === null ? { type: 'empty', value: null, display: null } : { type: 'string', value: c.unit, display: c.unit }
			}
		}))
	};
}

// Characters that are not allowed in XML 1.0 documents (OOXML / ODF).
// eslint-disable-next-line no-control-regex
const XML_INVALID = new RegExp(
	'[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]|[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]',
	'g'
);
const REPLACEMENT = String.fromCharCode(0xfffd);

export class XmlSanitizer {
	replaced = 0;
	clean(s: string): string {
		return s.replace(XML_INVALID, () => {
			this.replaced++;
			return REPLACEMENT;
		});
	}
	note(checks: string[]): void {
		if (this.replaced > 0) {
			checks.push(`XML에 넣을 수 없는 제어문자 ${this.replaced}개를 '${REPLACEMENT}'(U+FFFD)로 바꿨습니다 — 원본 값과 다릅니다`);
		}
	}
}

export function xmlEscape(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Whitespace-insensitive form used for "text appears in rendered output" checks. */
export function squash(s: string): string {
	return s.replace(/\s+/g, '');
}

export const VERSION_NOTE = 'Drive의 최신 파일은 분석 당시 바이트와 다를 수 있습니다. 아래 sha256/확보시각이 분석에 사용된 버전입니다.';
