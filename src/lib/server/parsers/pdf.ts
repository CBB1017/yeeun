import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TextBlock } from '../../shared/manifest';
import { AppError } from '../errors';
import { run, toolAvailable, withTempDir } from './exec';
import { linesToBlocks, ocrPng } from './ocr';
import type { ParseInput, ParseOutput } from './types';

interface PdfItem {
	str: string;
	transform: number[];
	width?: number;
	hasEOL?: boolean;
}

async function loadPdfjs() {
	return import('pdfjs-dist/legacy/build/pdf.mjs');
}

/**
 * One text line: items left→right. A horizontal gap much wider than a space
 * (separate columns / table cells) is kept as a tab so text from different
 * columns is not glued into one sentence.
 */
function lineText(items: PdfItem[]): string {
	const sorted = [...items].sort((a, b) => a.transform[4]! - b.transform[4]!);
	const upright = sorted.every((i) => !i.transform[1] && !i.transform[2] && typeof i.width === 'number');
	if (!upright) {
		return sorted
			.map((i) => i.str)
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim();
	}
	let out = '';
	let prevEnd: number | null = null;
	let pendingSpace = false;
	for (const it of sorted) {
		// whitespace-only items (cell padding, explicit spaces) only mark a separation
		if (!it.str.trim()) {
			pendingSpace = true;
			continue;
		}
		const x = it.transform[4]!;
		const size = Math.abs(it.transform[3]!) || 10;
		if (prevEnd !== null) {
			const gap = x - prevEnd;
			if (gap > size * 0.5) out += '\t';
			else if (pendingSpace || gap > size * 0.15 || /\s$/.test(out) || /^\s/.test(it.str)) out += ' ';
		}
		out += it.str;
		prevEnd = x + it.width!;
		pendingSpace = false;
	}
	return out
		.split('\t')
		.map((s) => s.replace(/\s+/g, ' ').trim())
		.filter(Boolean)
		.join('\t');
}

/** Text PDFs are read with pdf.js; pages without a text layer are OCR'd page by page. */
export async function parsePdf(input: ParseInput): Promise<ParseOutput> {
	const pdfjs = await loadPdfjs();
	const task = pdfjs.getDocument({
		data: new Uint8Array(input.bytes),
		disableFontFace: true,
		useSystemFonts: false,
		verbosity: 0
	});
	try {
		let doc;
		try {
			doc = await task.promise;
		} catch (e) {
			const msg = (e as Error).name === 'PasswordException' ? '암호화된 PDF' : (e as Error).message.slice(0, 120);
			throw new AppError('PARSE_FAILED', `PDF를 열 수 없음: ${msg}`, 'preparing');
		}
		if (!doc.numPages) throw new AppError('PARSE_FAILED', 'PDF에 페이지가 없음', 'preparing');
		const texts: TextBlock[] = [];
		const warnings: string[] = [];
		const scanned: number[] = [];
		const fi = input.fileIndex;
		for (let p = 1; p <= doc.numPages; p++) {
			let text: string;
			let rotation = 0;
			try {
				const page = await doc.getPage(p);
				rotation = page.rotate ?? 0;
				const content = await page.getTextContent();
				const items = (content.items as PdfItem[]).filter((i) => typeof i.str === 'string' && i.str !== '');
				// Group by line (y), order lines top→bottom, items left→right.
				const lines = new Map<number, PdfItem[]>();
				for (const it of items) {
					const y = Math.round(it.transform[5]! / 2) * 2;
					lines.set(y, [...(lines.get(y) ?? []), it]);
				}
				text = [...lines.entries()]
					.sort((a, b) => b[0] - a[0])
					.map(([, its]) => lineText(its))
					.filter(Boolean)
					.join('\n');
			} catch (e) {
				if (e instanceof AppError) throw e;
				throw new AppError('PARSE_FAILED', `PDF ${p}쪽을 읽을 수 없음 (손상): ${(e as Error).message.slice(0, 120)}`, 'preparing');
			}
			if (text.replace(/\s/g, '').length < 20) {
				scanned.push(p);
				continue;
			}
			texts.push({
				evidence_id: `f${fi}.p${p}`,
				kind: 'page',
				location: { page: p, rotation, source: 'text_layer' },
				text,
				ocr_confidence: null
			});
		}
		if (scanned.length) {
			if (input.ocrBudget.used + scanned.length > input.maxOcrPages) {
				throw new AppError(
					'SOURCE_TOO_LARGE',
					`OCR 필요 페이지 ${scanned.length}개가 한도(${input.maxOcrPages})를 초과 — 일부만 처리하지 않고 중단합니다`,
					'preparing'
				);
			}
			if (!(await toolAvailable('pdftoppm'))) {
				throw new AppError('CAPABILITY_UNAVAILABLE', '스캔 PDF 렌더러(pdftoppm)가 없음', 'preparing');
			}
			input.ocrBudget.used += scanned.length;
			await withTempDir(async (dir) => {
				const pdfPath = path.join(dir, 'in.pdf');
				await writeFile(pdfPath, input.bytes);
				for (const p of scanned) {
					const prefix = path.join(dir, `p${p}`);
					const r = await run('pdftoppm', ['-r', '300', '-f', String(p), '-l', String(p), '-png', '-singlefile', pdfPath, prefix], {
						timeoutMs: 120_000,
						cwd: dir
					});
					if (r.code !== 0) throw new AppError('PARSE_FAILED', `PDF ${p}쪽 렌더 실패`, 'preparing');
					const lines = await ocrPng(await readFile(`${prefix}.png`));
					if (lines.length === 0) warnings.push(`${p}쪽: OCR 인식 텍스트 없음`);
					const low = lines.filter((l) => l.conf < 60).length;
					if (low) warnings.push(`${p}쪽: OCR 신뢰도 낮은 줄 ${low}개 — 불확실`);
					texts.push(...linesToBlocks(lines, `f${fi}.p${p}`, { page: p, source: 'ocr', dpi: 300 }));
				}
			});
			warnings.push(`스캔 페이지 OCR 수행: ${scanned.join(', ')}쪽`);
		}
		return { tables: [], texts, warnings };
	} finally {
		await task.destroy().catch(() => undefined);
	}
}
