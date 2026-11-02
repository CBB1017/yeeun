/** Raster fixtures rendered locally with sharp (librsvg + fontconfig, Noto Sans CJK KR). */
import sharp from 'sharp';

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface TextImageOptions {
	width?: number;
	height?: number;
	fontSize?: number;
	/** Lines are drawn top-down starting at `top`. */
	top?: number;
	left?: number;
	lineGap?: number;
}

export function textSvg(lines: string[], o: TextImageOptions = {}): Buffer {
	const fs = o.fontSize ?? 48;
	const gap = o.lineGap ?? Math.round(fs * 1.6);
	const width = o.width ?? 1600;
	const height = o.height ?? (o.top ?? 80) + gap * lines.length + 60;
	const left = o.left ?? 60;
	const top = o.top ?? 80;
	const body = lines
		.map(
			(l, i) => `<text x="${left}" y="${top + i * gap + fs}" font-family="Noto Sans CJK KR" font-size="${fs}" fill="#000">${esc(l)}</text>`
		)
		.join('');
	return Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`
	);
}

export async function textPng(lines: string[], o: TextImageOptions = {}): Promise<Buffer> {
	return sharp(textSvg(lines, o)).flatten({ background: '#fff' }).png().toBuffer();
}

export async function textJpeg(lines: string[], o: TextImageOptions = {}): Promise<Buffer> {
	return sharp(textSvg(lines, o)).flatten({ background: '#fff' }).jpeg({ quality: 95 }).toBuffer();
}

/**
 * JPEG whose stored pixels are rotated 90° counter-clockwise, with EXIF
 * Orientation=6 ("rotate 90° CW to display"), so it only reads upright when
 * the orientation tag is honoured.
 */
export async function exifRotatedJpeg(lines: string[], o: TextImageOptions = {}): Promise<Buffer> {
	const upright = await sharp(textSvg(lines, o)).flatten({ background: '#fff' }).png().toBuffer();
	const stored = await sharp(upright).rotate(270).toBuffer();
	return sharp(stored).jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toBuffer();
}

export async function blankPng(width = 1200, height = 800): Promise<Buffer> {
	return sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
		.png()
		.toBuffer();
}
