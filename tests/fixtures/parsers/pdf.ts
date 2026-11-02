/**
 * Minimal hand-written PDF writer for fixtures: text pages (Helvetica, WinAnsi)
 * and image-only "scanned" pages (JPEG/DCTDecode), optional /Rotate.
 */
import sharp from 'sharp';

export type PdfPage =
	| { kind: 'text'; lines: { x: number; y: number; text: string; size?: number }[]; rotate?: number; width?: number; height?: number }
	| { kind: 'image'; jpeg: Buffer; rotate?: number; width?: number; height?: number };

function escText(s: string): string {
	return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export async function buildPdf(pages: PdfPage[]): Promise<Buffer> {
	const objs: (Buffer | string)[] = [];
	const add = (o: Buffer | string) => {
		objs.push(o);
		return objs.length;
	};
	const catalog = add('');
	const pagesObj = add('');
	const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
	const kids: number[] = [];
	for (const p of pages) {
		const w = p.width ?? 612;
		const h = p.height ?? 792;
		let content: string;
		let resources: string;
		if (p.kind === 'text') {
			content = p.lines.map((l) => `BT /F1 ${l.size ?? 12} Tf ${l.x} ${l.y} Td (${escText(l.text)}) Tj ET`).join('\n');
			resources = `<< /Font << /F1 ${font} 0 R >> >>`;
		} else {
			const meta = await sharp(p.jpeg).metadata();
			const img = add(
				Buffer.concat([
					Buffer.from(
						`<< /Type /XObject /Subtype /Image /Width ${meta.width} /Height ${meta.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`
					),
					p.jpeg,
					Buffer.from('\nendstream')
				])
			);
			content = `q ${w} 0 0 ${h} 0 0 cm /Im1 Do Q`;
			resources = `<< /XObject << /Im1 ${img} 0 R >> >>`;
		}
		const cs = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
		kids.push(
			add(
				`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${w} ${h}] /Resources ${resources} /Contents ${cs} 0 R${
					p.rotate ? ` /Rotate ${p.rotate}` : ''
				} >>`
			)
		);
	}
	objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
	objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

	const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
	let offset = chunks[0]!.length;
	const offsets: number[] = [];
	objs.forEach((o, i) => {
		offsets.push(offset);
		const b = Buffer.concat([
			Buffer.from(`${i + 1} 0 obj\n`, 'latin1'),
			typeof o === 'string' ? Buffer.from(o, 'latin1') : o,
			Buffer.from('\nendobj\n', 'latin1')
		]);
		chunks.push(b);
		offset += b.length;
	});
	const xref =
		`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
		offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
		`trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
	chunks.push(Buffer.from(xref, 'latin1'));
	return Buffer.concat(chunks);
}

/** HTML used to make a real text PDF with LibreOffice Writer (Korean + English, two columns, a table). */
export const DOC_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:'Noto Sans CJK KR';font-size:12pt}</style></head><body>
<p style="font-size:18pt"><b>연구 일정 Research Schedule</b></p>
<p>본 문서는 마감일 검증용 예시입니다. This document is a deadline verification example.</p>
<table border="0" width="100%"><tr>
<td width="50%" valign="top"><p>왼쪽 단: 실험 계획과 장비 예약을 정리한다. Left column text about planning.</p></td>
<td width="50%" valign="top"><p>오른쪽 단: 보고서 제출 마감 2026-11-30. Right column text about reporting.</p></td>
</tr></table>
<table border="1" cellpadding="4"><tr><th>과제</th><th>마감일</th><th>코드</th></tr>
<tr><td>Proposal</td><td>2026-11-30</td><td>00123</td></tr>
<tr><td>Report</td><td>2027-01-15</td><td>00456</td></tr></table>
</body></html>`;
