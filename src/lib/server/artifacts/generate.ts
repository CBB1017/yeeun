import sharp from 'sharp';
import { isAppError } from '../errors';
import type { OutputFormat } from '../../shared/plan';
import { effectiveTable, fail, slugify } from './common';
import { buildDelimited, validateDelimited } from './delimited';
import { MAX_RENDER_PAGES, buildFodt, libreOffice, renderPdfPages, validatePdf } from './pdf';
import { buildPptx, validatePptx } from './pptx';
import { buildXlsx, validateXlsx } from './xlsx';

/**
 * Output artifact generation. Every artifact is a NEW file built from the result data;
 * source originals are never read or modified here. Each file is reopened and validated
 * before it is returned — an unvalidated file is never returned.
 */

export interface ResultColumn {
	column_id: string;
	label: string;
}
export interface ResultCell {
	type: 'number' | 'date' | 'string' | 'boolean' | 'empty' | 'error' | 'formula_uncomputed';
	value: string | null;
	display: string | null;
}
export interface ResultTable {
	columns: ResultColumn[];
	rows: { record_id: string; cells: Record<string, ResultCell> }[];
}
export interface ArtifactInput {
	title: string;
	summary: string;
	claims: {
		claim_key: string;
		value: string;
		type: string;
		unit: string | null;
	}[];
	/** Source headers & column order are preserved exactly. */
	table: ResultTable | null;
	versionInfo: {
		name: string;
		sha256: string;
		provider_revision: string | null;
		captured_at: string;
	}[];
	warnings: string[];
	csvEncoding: 'utf-8' | 'utf-8-bom' | 'cp949';
}
export interface GeneratedArtifact {
	format: OutputFormat;
	filename: string;
	mimeType: string;
	bytes: Buffer;
	validation: {
		reopened: true;
		checks: string[];
		rowCount: number | null;
		formulaInjectionEscaped: number;
		previewPng: Buffer | null;
	};
}

const PREVIEW_DPI = 80;
const IMAGE_DPI = 150;

function charsetLabel(enc: ArtifactInput['csvEncoding']): string {
	// WHATWG maps the "euc-kr" label to the windows-949 (CP949) decoder.
	return enc === 'cp949' ? 'euc-kr' : 'utf-8';
}

function injectionNote(n: number): string[] {
	return n > 0
		? [
				`수식 실행 방지를 위해 =, +, -, @, 탭, CR로 시작하는 셀 ${n}개 앞에 작은따옴표(')를 붙였습니다 — 다운로드 파일의 해당 값은 원본과 다릅니다`
			]
		: [];
}

export async function generateArtifacts(input: ArtifactInput, formats: OutputFormat[]): Promise<GeneratedArtifact[]> {
	try {
		return await generate(input, formats);
	} catch (e) {
		if (isAppError(e)) throw e;
		fail(`결과 파일 생성/검증 실패: ${(e as Error).message?.slice(0, 160) ?? String(e)}`);
	}
}

async function generate(input: ArtifactInput, formats: OutputFormat[]): Promise<GeneratedArtifact[]> {
	const wanted = [...new Set(formats)];
	const stem = slugify(input.title);
	const headers = effectiveTable(input).columns.map((c) => c.label);
	const out: GeneratedArtifact[] = [];

	// The PDF is shared by pdf/png/jpeg so all three show the same rendering.
	let pdfCache: { bytes: Buffer; pages: number; checks: string[] } | null = null;
	const getPdf = async () => {
		if (pdfCache) return pdfCache;
		const { xml, san } = buildFodt(input);
		const bytes = await libreOffice(Buffer.from(xml, 'utf-8'), 'fodt', 'pdf', 'PDF');
		const v = await validatePdf(bytes, [input.title, ...headers]);
		san.note(v.checks);
		pdfCache = { bytes, pages: v.pages, checks: v.checks };
		return pdfCache;
	};

	for (const format of wanted) {
		switch (format) {
			case 'csv':
			case 'tsv': {
				const delimiter = format === 'csv' ? ',' : '\t';
				const d = buildDelimited(input, delimiter);
				const checks = validateDelimited(d.bytes, d.records, delimiter, input.csvEncoding);
				checks.push(...injectionNote(d.escaped));
				out.push({
					format,
					filename: `${stem}.${format}`,
					mimeType: `${format === 'csv' ? 'text/csv' : 'text/tab-separated-values'}; charset=${charsetLabel(input.csvEncoding)}`,
					bytes: d.bytes,
					validation: {
						reopened: true,
						checks,
						rowCount: d.rowCount,
						formulaInjectionEscaped: d.escaped,
						previewPng: null
					}
				});
				break;
			}
			case 'xlsx': {
				const x = await buildXlsx(input);
				const checks = await validateXlsx(x.bytes, x.plans);
				checks.push('문자열 셀은 텍스트로만 저장(수식으로 해석되지 않음)');
				x.san.note(checks);
				out.push({
					format,
					filename: `${stem}.xlsx`,
					mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
					bytes: x.bytes,
					validation: {
						reopened: true,
						checks,
						rowCount: x.rowCount,
						formulaInjectionEscaped: 0,
						previewPng: null
					}
				});
				break;
			}
			case 'pdf': {
				const pdf = await getPdf();
				const [preview] = await renderPdfPages(pdf.bytes, PREVIEW_DPI, 1);
				const checks = [...pdf.checks, `1쪽 미리보기 렌더(${PREVIEW_DPI}dpi PNG) 생성`];
				out.push({
					format,
					filename: `${stem}.pdf`,
					mimeType: 'application/pdf',
					bytes: pdf.bytes,
					validation: {
						reopened: true,
						checks,
						rowCount: null,
						formulaInjectionEscaped: 0,
						previewPng: preview!
					}
				});
				break;
			}
			case 'pptx': {
				const p = await buildPptx(input);
				const checks = await validatePptx(p.bytes, p.plan);
				const asPdf = await libreOffice(p.bytes, 'pptx', 'pdf', 'pptx 미리보기');
				const v = await validatePdf(asPdf, p.plan.headers, 'pptx 렌더');
				if (v.pages !== p.plan.slideCount) fail(`pptx 렌더 쪽수 불일치: ${v.pages} ≠ ${p.plan.slideCount}`);
				const [preview] = await renderPdfPages(asPdf, PREVIEW_DPI, 1);
				checks.push(...v.checks, `1번 슬라이드 미리보기 렌더(${PREVIEW_DPI}dpi PNG) 생성`);
				if (p.truncatedSummary) checks.push('요약이 길어 첫 슬라이드에는 일부만 표시했습니다 (전체는 xlsx/pdf)');
				p.san.note(checks);
				out.push({
					format,
					filename: `${stem}.pptx`,
					mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
					bytes: p.bytes,
					validation: {
						reopened: true,
						checks,
						rowCount: p.plan.tableDataRows,
						formulaInjectionEscaped: 0,
						previewPng: preview!
					}
				});
				break;
			}
			case 'png':
			case 'jpeg': {
				const pdf = await getPdf();
				if (pdf.pages > MAX_RENDER_PAGES) {
					fail(`이미지로 만들 PDF가 ${pdf.pages}쪽으로 한도(${MAX_RENDER_PAGES}쪽)를 넘습니다 — 일부만 만들지 않고 중단합니다`);
				}
				const pngs = await renderPdfPages(pdf.bytes, IMAGE_DPI, null);
				if (pngs.length !== pdf.pages) fail(`이미지 페이지 수 불일치: ${pngs.length} ≠ ${pdf.pages}`);
				const ext = format === 'png' ? 'png' : 'jpg';
				const width = String(pngs.length).length;
				for (let i = 0; i < pngs.length; i++) {
					const img =
						format === 'png'
							? await sharp(pngs[i]!).png({ compressionLevel: 9 }).toBuffer()
							: await sharp(pngs[i]!).flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
					const meta = await sharp(img).metadata();
					if (!meta.width || !meta.height) fail(`${i + 1}쪽 이미지 크기를 읽을 수 없음`);
					if (meta.format !== (format === 'png' ? 'png' : 'jpeg')) fail(`${i + 1}쪽 이미지 형식 불일치: ${meta.format}`);
					const suffix = pngs.length > 1 ? `-p${String(i + 1).padStart(width, '0')}` : '';
					out.push({
						format,
						filename: `${stem}${suffix}.${ext}`,
						mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
						bytes: img,
						validation: {
							reopened: true,
							checks: [...pdf.checks, `${i + 1}/${pngs.length}쪽 ${format.toUpperCase()} 다시 열기: ${meta.width}×${meta.height}px`],
							rowCount: null,
							formulaInjectionEscaped: 0,
							previewPng: null
						}
					});
				}
				break;
			}
			default:
				fail(`지원하지 않는 출력 형식: ${String(format)}`);
		}
	}
	return out;
}
