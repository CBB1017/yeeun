import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { TextBlock } from '../../shared/manifest';
import { AppError } from '../errors';
import { run, toolAvailable, withTempDir } from './exec';

/** Local Tesseract OCR (kor+eng). No remote OCR/LLM OCR is ever used. */

interface OcrLine {
	text: string;
	conf: number;
	left: number;
	top: number;
	width: number;
	height: number;
}

function parseTsv(tsv: string): OcrLine[] {
	const lines = new Map<string, { words: string[]; confs: number[]; l: number; t: number; r: number; b: number }>();
	for (const row of tsv.split('\n').slice(1)) {
		const c = row.split('\t');
		if (c.length < 12 || c[0] !== '5') continue;
		const text = c[11]!.trim();
		if (!text) continue;
		const key = `${c[2]}.${c[3]}.${c[4]}`;
		const [l, t, w, h, conf] = [c[6], c[7], c[8], c[9], c[10]].map(Number) as [number, number, number, number, number];
		const e = lines.get(key) ?? { words: [], confs: [], l, t, r: l + w, b: t + h };
		e.words.push(text);
		e.confs.push(conf);
		e.l = Math.min(e.l, l);
		e.t = Math.min(e.t, t);
		e.r = Math.max(e.r, l + w);
		e.b = Math.max(e.b, t + h);
		lines.set(key, e);
	}
	return [...lines.values()].map((e) => ({
		text: e.words.join(' '),
		conf: e.confs.reduce((a, b) => a + b, 0) / e.confs.length,
		left: e.l,
		top: e.t,
		width: e.r - e.l,
		height: e.b - e.t
	}));
}

export async function ocrPng(png: Buffer): Promise<OcrLine[]> {
	if (!(await toolAvailable('tesseract'))) {
		throw new AppError('CAPABILITY_UNAVAILABLE', 'OCR(tesseract)이 이 컨테이너에 없음', 'preparing');
	}
	return withTempDir(async (dir) => {
		const img = path.join(dir, 'in.png');
		await writeFile(img, png);
		const r = await run('tesseract', [img, 'stdout', '-l', 'kor+eng', '--psm', '3', 'tsv'], { timeoutMs: 180_000, cwd: dir });
		if (r.code !== 0) throw new AppError('PARSE_FAILED', `OCR 실패: ${r.stderr.slice(0, 200)}`, 'preparing');
		return parseTsv(r.stdout.toString('utf8'));
	});
}

/** Each recognised line becomes a region evidence block with its bounding box. */
export function linesToBlocks(lines: OcrLine[], idPrefix: string, loc: Record<string, string | number>): TextBlock[] {
	return lines.map((l, i) => ({
		evidence_id: `${idPrefix}.l${i + 1}`,
		kind: 'region' as const,
		location: { ...loc, left: l.left, top: l.top, width: l.width, height: l.height },
		text: l.text,
		ocr_confidence: Math.round(l.conf * 10) / 10
	}));
}

export async function ocrImage(bytes: Buffer, fileIndex: number, budget: { used: number }, max: number) {
	if (budget.used + 1 > max) {
		throw new AppError('SOURCE_TOO_LARGE', `OCR 페이지 한도(${max}) 초과 — 자료 범위를 줄이거나 한도를 조정하세요`, 'preparing');
	}
	budget.used += 1;
	// Apply EXIF orientation; upscale small images for small text.
	let png: Buffer;
	let orientation = 1;
	let width = 0;
	let height = 0;
	let scale = 1;
	try {
		const meta = await sharp(bytes, { failOn: 'error' }).metadata();
		orientation = meta.orientation ?? 1;
		// dimensions after auto-orientation (orientations 5-8 swap axes)
		width = (orientation >= 5 ? meta.height : meta.width) ?? 0;
		height = (orientation >= 5 ? meta.width : meta.height) ?? 0;
		let img = sharp(bytes, { failOn: 'error' }).rotate();
		if (width > 0 && width < 1200) {
			img = img.resize({ width: 1600, withoutEnlargement: false });
			scale = 1600 / width;
		}
		png = await img.png().toBuffer();
	} catch (e) {
		throw new AppError(
			'PARSE_FAILED',
			`이미지를 열 수 없음 (손상 또는 지원하지 않는 형식): ${(e as Error).message.slice(0, 120)}`,
			'preparing'
		);
	}
	let raw = await ocrPng(png);
	if (scale !== 1 && meanConf(raw) < 70) {
		// Upscaling can push already-large glyphs out of Tesseract's sweet spot:
		// also try the oriented original and keep the more confident reading.
		const original = await ocrPng(await sharp(bytes, { failOn: 'error' }).rotate().png().toBuffer());
		if (meanConf(original) > meanConf(raw)) {
			raw = original;
			scale = 1;
		}
	}
	const lines = raw.map((l) =>
		scale === 1
			? l
			: {
					...l,
					// region bounds are reported in the (oriented) source image's pixel space
					left: Math.round(l.left / scale),
					top: Math.round(l.top / scale),
					width: Math.max(1, Math.round(l.width / scale)),
					height: Math.max(1, Math.round(l.height / scale))
				}
	);
	const warnings: string[] = [];
	if (lines.length === 0) warnings.push('이미지에서 인식된 텍스트 없음 (빈 이미지이거나 판독 불가)');
	const low = lines.filter((l) => l.conf < 60).length;
	if (low) warnings.push(`OCR 신뢰도 60 미만 줄 ${low}개 — 불확실`);
	return {
		texts: linesToBlocks(lines, `f${fileIndex}.img`, { image: 1, orientation, image_width: width, image_height: height }),
		warnings
	};
}

function meanConf(lines: { conf: number; text: string }[]): number {
	const n = lines.reduce((a, l) => a + l.text.length, 0);
	return n ? lines.reduce((a, l) => a + l.conf * l.text.length, 0) / n : 0;
}
