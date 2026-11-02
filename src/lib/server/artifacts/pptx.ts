import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import type { ArtifactInput } from './generate';
import { KOREAN_FONT, VERSION_NOTE, XmlSanitizer, cellDisplay, effectiveTable, fail, squash } from './common';

export const ROWS_PER_SLIDE = 12;
export const COLS_PER_SLIDE = 8;
const SUMMARY_MAX_CHARS = 1200;

type Cell = { text: string; options?: Record<string, unknown> };

function chunk<T>(xs: T[], n: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
	return out;
}

export interface PptxPlan {
	slideCount: number;
	headers: string[];
	/** Data rows written across all result-table slides (rows × column groups). */
	tableDataRows: number;
	tableSlides: number;
}

export async function buildPptx(input: ArtifactInput): Promise<{
	bytes: Buffer;
	plan: PptxPlan;
	san: XmlSanitizer;
	truncatedSummary: boolean;
}> {
	const san = new XmlSanitizer();
	const table = effectiveTable(input);
	const pptx = new PptxGenJS();
	pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
	pptx.title = san.clean(input.title);
	pptx.theme = {
		headFontFace: KOREAN_FONT,
		bodyFontFace: KOREAN_FONT,
		lang: 'ko-KR'
	} as never;
	const base = { fontFace: KOREAN_FONT, lang: 'ko-KR' };
	let slideCount = 0;

	// 1. Title / summary slide.
	const s1 = pptx.addSlide();
	slideCount++;
	s1.addText(san.clean(input.title), {
		...base,
		x: 0.5,
		y: 0.4,
		w: 12.3,
		h: 0.9,
		fontSize: 28,
		bold: true,
		color: '1F2937'
	});
	const truncatedSummary = input.summary.length > SUMMARY_MAX_CHARS;
	const summary = truncatedSummary ? `${input.summary.slice(0, SUMMARY_MAX_CHARS)}… (전체 요약은 xlsx/pdf 참고)` : input.summary;
	s1.addText(san.clean(summary), {
		...base,
		x: 0.5,
		y: 1.4,
		w: 12.3,
		h: 3.6,
		fontSize: 16,
		valign: 'top',
		color: '374151'
	});
	if (input.warnings.length) {
		s1.addText(san.clean(input.warnings.map((w) => `⚠ ${w}`).join('\n')), {
			...base,
			x: 0.5,
			y: 5.1,
			w: 12.3,
			h: 1.4,
			fontSize: 12,
			valign: 'top',
			color: '9A3B00'
		});
	}
	s1.addText(san.clean(`결과 ${table.rows.length}행 · 열 ${table.columns.length}개`), {
		...base,
		x: 0.5,
		y: 6.7,
		w: 12.3,
		h: 0.4,
		fontSize: 11,
		color: '6B7280'
	});

	// 2. Result table slides, paginated by rows and (for wide tables) by column groups.
	const colGroups = chunk(table.columns, COLS_PER_SLIDE);
	const rowPages = table.rows.length ? chunk(table.rows, ROWS_PER_SLIDE) : [[]];
	let tableDataRows = 0;
	let tableSlides = 0;
	const totalSlidesForTable = rowPages.length * colGroups.length;
	rowPages.forEach((rows, ri) => {
		colGroups.forEach((cols, gi) => {
			const slide = pptx.addSlide();
			slideCount++;
			tableSlides++;
			const first = ri * ROWS_PER_SLIDE + 1;
			const lastRow = ri * ROWS_PER_SLIDE + rows.length;
			const colInfo =
				colGroups.length > 1 ? ` · 열 ${gi * COLS_PER_SLIDE + 1}–${gi * COLS_PER_SLIDE + cols.length}/${table.columns.length}` : '';
			const range = rows.length ? `${first}–${lastRow}/${table.rows.length}행` : '0행';
			slide.addText(san.clean(`결과 (${range}${colInfo}) · ${tableSlides}/${totalSlidesForTable}`), {
				...base,
				x: 0.4,
				y: 0.2,
				w: 12.5,
				h: 0.5,
				fontSize: 14,
				bold: true,
				color: '1F2937'
			});
			const head: Cell[] = cols.map((c) => ({
				text: san.clean(c.label),
				options: { bold: true, fill: { color: 'E6ECF5' } }
			}));
			const body: Cell[][] = rows.map((r) =>
				cols.map((c) => ({
					text: san.clean(cellDisplay(r.cells[c.column_id]))
				}))
			);
			tableDataRows += body.length;
			slide.addTable([head, ...body] as never, {
				...base,
				x: 0.4,
				y: 0.8,
				w: 12.5,
				colW: Array(cols.length).fill(12.5 / cols.length),
				fontSize: 10,
				border: { type: 'solid', pt: 0.5, color: '9A9A9A' },
				valign: 'top',
				margin: 0.04
			});
			if (!rows.length)
				slide.addText('결과 행 0건', {
					...base,
					x: 0.4,
					y: 1.6,
					w: 12.5,
					h: 0.5,
					fontSize: 14,
					color: '6B7280'
				});
		});
	});

	// 3. Claims (only when a result table exists; otherwise claims already are the table).
	if (input.table && input.table.columns.length && input.claims.length) {
		for (const part of chunk(input.claims, ROWS_PER_SLIDE)) {
			const slide = pptx.addSlide();
			slideCount++;
			slide.addText('주장(claims)', {
				...base,
				x: 0.4,
				y: 0.2,
				w: 12.5,
				h: 0.5,
				fontSize: 14,
				bold: true
			});
			const head = ['claim_key', 'value', 'type', 'unit'].map((t) => ({
				text: t,
				options: { bold: true, fill: { color: 'E6ECF5' } }
			}));
			const body = part.map((c) =>
				[c.claim_key, c.value, c.type, c.unit ?? ''].map((t) => ({
					text: san.clean(t)
				}))
			);
			slide.addTable([head, ...body] as never, {
				...base,
				x: 0.4,
				y: 0.8,
				w: 12.5,
				fontSize: 10,
				border: { type: 'solid', pt: 0.5, color: '9A9A9A' }
			});
		}
	}

	// 4. Version / evidence slide.
	for (const part of chunk(input.versionInfo, ROWS_PER_SLIDE).concat(input.versionInfo.length ? [] : [[]])) {
		const slide = pptx.addSlide();
		slideCount++;
		slide.addText('분석에 사용한 파일 버전', {
			...base,
			x: 0.4,
			y: 0.2,
			w: 12.5,
			h: 0.5,
			fontSize: 14,
			bold: true
		});
		slide.addText(VERSION_NOTE, {
			...base,
			x: 0.4,
			y: 0.7,
			w: 12.5,
			h: 0.4,
			fontSize: 10,
			color: '6B7280'
		});
		const head = ['파일명', 'sha256', 'provider_revision', 'captured_at'].map((t) => ({
			text: t,
			options: { bold: true, fill: { color: 'E6ECF5' } }
		}));
		const body = part.map((v) =>
			[v.name, v.sha256, v.provider_revision ?? '', v.captured_at].map((t) => ({
				text: san.clean(t)
			}))
		);
		slide.addTable([head, ...body] as never, {
			...base,
			x: 0.4,
			y: 1.2,
			w: 12.5,
			colW: [3.2, 5.0, 2.0, 2.3],
			fontSize: 9,
			border: { type: 'solid', pt: 0.5, color: '9A9A9A' }
		});
	}

	const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
	return {
		bytes: Buffer.from(out),
		plan: {
			slideCount,
			headers: table.columns.map((c) => san.clean(c.label)),
			tableDataRows,
			tableSlides
		},
		san,
		truncatedSummary
	};
}

function decodeXml(s: string): string {
	return s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&amp;/g, '&');
}

/** Unzip, count slides, find header labels in the slide XML and count table data rows. */
export async function validatePptx(bytes: Buffer, plan: PptxPlan): Promise<string[]> {
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(bytes);
	} catch (e) {
		fail(`생성한 pptx를 다시 열 수 없음: ${(e as Error).message.slice(0, 120)}`);
	}
	const slideFiles = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
	if (slideFiles.length !== plan.slideCount) fail(`슬라이드 수 불일치: ${slideFiles.length} ≠ ${plan.slideCount}`);
	slideFiles.sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
	let allText = '';
	let dataRows = 0;
	for (let i = 0; i < slideFiles.length; i++) {
		const xml = await zip.file(slideFiles[i]!)!.async('string');
		allText += [...xml.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1]!)).join('');
		// Result-table slides directly follow the title slide.
		if (i >= 1 && i <= plan.tableSlides) {
			const trs = (xml.match(/<a:tr[\s>]/g) ?? []).length;
			if (trs < 1) fail(`${i + 1}번 슬라이드에 표가 없음`);
			dataRows += trs - 1;
		}
	}
	const hay = squash(allText);
	const missing = plan.headers.filter((h) => squash(h) && !hay.includes(squash(h)));
	if (missing.length) fail(`pptx에 헤더 라벨 ${missing.length}개가 없음 (예: ${missing[0]!.slice(0, 40)})`);
	if (dataRows !== plan.tableDataRows) fail(`pptx 표 데이터 행 수 불일치: ${dataRows} ≠ ${plan.tableDataRows}`);
	return [
		`pptx 다시 열기: 슬라이드 ${slideFiles.length}장`,
		`헤더 라벨 ${plan.headers.length}개 확인, 표 슬라이드 ${plan.tableSlides}장의 데이터 행 ${dataRows}개 일치`
	];
}
