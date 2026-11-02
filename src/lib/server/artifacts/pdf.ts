import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isAppError } from '../errors';
import { run, toolAvailable, withTempDir } from '../parsers/exec';
import { convertWithLibreOffice } from '../parsers/index';
import type { ArtifactInput } from './generate';
import { KOREAN_FONT, VERSION_NOTE, XmlSanitizer, cellDisplay, effectiveTable, fail, squash, xmlEscape } from './common';

export const MAX_RENDER_PAGES = 200;

/** Paragraph content with ODF whitespace/line-break markup. */
function odfText(s: string, san: XmlSanitizer): string {
	const lines = san.clean(s).replace(/\r\n?/g, '\n').split('\n');
	return lines
		.map((line) =>
			xmlEscape(line)
				.replace(/\t/g, '<text:tab/>')
				.replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`)
				.replace(/^ /, '<text:s/>')
		)
		.join('<text:line-break/>');
}

function p(style: string, s: string, san: XmlSanitizer): string {
	return `<text:p text:style-name="${style}">${odfText(s, san)}</text:p>`;
}

function odfTable(name: string, header: string[], rows: string[][], san: XmlSanitizer): string {
	const n = Math.max(1, header.length);
	const cols = `<table:table-column table:style-name="Col" table:number-columns-repeated="${n}"/>`;
	const cell = (style: string, pstyle: string, s: string) =>
		`<table:table-cell table:style-name="${style}" office:value-type="string">${p(pstyle, s, san)}</table:table-cell>`;
	const head = `<table:table-header-rows><table:table-row>${header.map((h) => cell('HCell', 'TH', h)).join('')}</table:table-row></table:table-header-rows>`;
	const body = rows.map((r) => `<table:table-row>${r.map((v) => cell('Cell', 'TD', v)).join('')}</table:table-row>`).join('');
	return `<table:table table:name="${xmlEscape(name)}" table:style-name="Tbl">${cols}${head}${body}</table:table>`;
}

export function buildFodt(input: ArtifactInput): {
	xml: string;
	headers: string[];
	san: XmlSanitizer;
} {
	const san = new XmlSanitizer();
	const table = effectiveTable(input);
	const headers = table.columns.map((c) => c.label);
	const rows = table.rows.map((r) => table.columns.map((c) => cellDisplay(r.cells[c.column_id])));
	const parts: string[] = [];
	parts.push(p('Title', input.title, san));
	parts.push(p('Body', input.summary, san));
	for (const w of input.warnings) parts.push(p('Warn', `⚠ ${w}`, san));
	parts.push(p('H2', `결과 (${rows.length}행)`, san));
	parts.push(odfTable('result', headers, rows, san));
	if (rows.length === 0) parts.push(p('Body', '결과 행 0건', san));
	if (input.table && input.claims.length) {
		parts.push(p('H2', '주장(claims)', san));
		parts.push(
			odfTable(
				'claims',
				['claim_key', 'value', 'type', 'unit'],
				input.claims.map((c) => [c.claim_key, c.value, c.type, c.unit ?? '']),
				san
			)
		);
	}
	parts.push(p('H2', '분석에 사용한 파일 버전', san));
	parts.push(p('Small', VERSION_NOTE, san));
	parts.push(
		odfTable(
			'versions',
			['파일명', 'sha256', 'provider_revision', 'captured_at'],
			input.versionInfo.map((v) => [v.name, v.sha256, v.provider_revision ?? '', v.captured_at]),
			san
		)
	);
	const font = xmlEscape(KOREAN_FONT);
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">
<office:font-face-decls><style:font-face style:name="${font}" svg:font-family="'${font}'" style:font-family-generic="swiss" style:font-pitch="variable"/></office:font-face-decls>
<office:styles>
<style:default-style style:family="paragraph"><style:paragraph-properties fo:hyphenation-ladder-count="no-limit"/><style:text-properties style:font-name="${font}" style:font-name-asian="${font}" style:font-name-complex="${font}" fo:font-size="9pt" style:font-size-asian="9pt" style:font-size-complex="9pt" fo:language="ko" fo:country="KR" style:language-asian="ko" style:country-asian="KR" fo:hyphenate="false"/></style:default-style>
</office:styles>
<office:automatic-styles>
<style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="29.7cm" fo:page-height="21cm" style:print-orientation="landscape" fo:margin-top="1.2cm" fo:margin-bottom="1.2cm" fo:margin-left="1.2cm" fo:margin-right="1.2cm"/></style:page-layout>
<style:style style:name="Tbl" style:family="table"><style:table-properties style:width="27.3cm" table:align="margins" fo:margin-top="0.15cm" fo:margin-bottom="0.3cm"/></style:style>
<style:style style:name="Col" style:family="table-column"><style:table-column-properties style:use-optimal-column-width="false"/></style:style>
<style:style style:name="Cell" style:family="table-cell"><style:table-cell-properties fo:border="0.5pt solid #9a9a9a" fo:padding="0.06cm"/></style:style>
<style:style style:name="HCell" style:family="table-cell"><style:table-cell-properties fo:border="0.5pt solid #9a9a9a" fo:padding="0.06cm" fo:background-color="#e6ecf5"/></style:style>
<style:style style:name="TD" style:family="paragraph"><style:text-properties fo:font-size="8.5pt" style:font-size-asian="8.5pt"/></style:style>
<style:style style:name="TH" style:family="paragraph"><style:text-properties fo:font-size="8.5pt" style:font-size-asian="8.5pt" fo:font-weight="bold" style:font-weight-asian="bold"/></style:style>
<style:style style:name="Title" style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.25cm"/><style:text-properties fo:font-size="16pt" style:font-size-asian="16pt" fo:font-weight="bold" style:font-weight-asian="bold"/></style:style>
<style:style style:name="H2" style:family="paragraph"><style:paragraph-properties fo:margin-top="0.35cm" fo:margin-bottom="0.1cm"/><style:text-properties fo:font-size="11pt" style:font-size-asian="11pt" fo:font-weight="bold" style:font-weight-asian="bold"/></style:style>
<style:style style:name="Body" style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.12cm"/><style:text-properties fo:font-size="10pt" style:font-size-asian="10pt"/></style:style>
<style:style style:name="Warn" style:family="paragraph"><style:text-properties fo:font-size="9pt" style:font-size-asian="9pt" fo:color="#9a3b00"/></style:style>
<style:style style:name="Small" style:family="paragraph"><style:text-properties fo:font-size="8pt" style:font-size-asian="8pt" fo:color="#555555"/></style:style>
</office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles>
<office:body><office:text>${parts.join('\n')}</office:text></office:body>
</office:document>
`;
	return { xml, headers, san };
}

/** LibreOffice conversion; converter errors are reported as output-generation failures. */
export async function libreOffice(bytes: Buffer, fromExt: string, toExt: string, what: string): Promise<Buffer> {
	try {
		return await convertWithLibreOffice(bytes, fromExt, toExt);
	} catch (e) {
		if (isAppError(e) && e.code === 'CAPABILITY_UNAVAILABLE') throw e;
		fail(`${what} 생성 실패 (LibreOffice ${fromExt} → ${toExt})`);
	}
}

/** Reopen with pdf.js: page count > 0 and every expected text (whitespace-insensitive) present. */
export async function validatePdf(bytes: Buffer, mustContain: string[], what = 'PDF'): Promise<{ pages: number; checks: string[] }> {
	const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
	const task = pdfjs.getDocument({
		data: new Uint8Array(bytes),
		disableFontFace: true,
		useSystemFonts: false,
		verbosity: 0
	});
	try {
		let doc;
		try {
			doc = await task.promise;
		} catch (e) {
			fail(`생성한 ${what}를 다시 열 수 없음: ${(e as Error).message.slice(0, 120)}`);
		}
		const pages = doc.numPages;
		if (pages <= 0) fail(`${what}에 페이지가 없음`);
		let all = '';
		for (let i = 1; i <= pages; i++) {
			const page = await doc.getPage(i);
			const content = await page.getTextContent();
			for (const it of content.items as { str?: string }[]) if (typeof it.str === 'string') all += it.str;
		}
		const hay = squash(all);
		const missing = mustContain.map(squash).filter((t) => t.length > 0 && !hay.includes(t));
		if (missing.length) fail(`${what} 텍스트 레이어에 헤더/텍스트 ${missing.length}개가 없음 (예: ${missing[0]!.slice(0, 40)})`);
		return {
			pages,
			checks: [`${what} 다시 열기: ${pages}쪽`, `${what} 텍스트 레이어에 제목·헤더 ${mustContain.filter((t) => squash(t)).length}개 확인`]
		};
	} finally {
		await task.destroy();
	}
}

/** Render PDF pages to PNG with poppler. `last` = null renders every page. */
export async function renderPdfPages(pdf: Buffer, dpi: number, last: number | null): Promise<Buffer[]> {
	if (!(await toolAvailable('pdftoppm'))) fail('PDF 렌더러(pdftoppm)가 없어 이미지/미리보기를 만들 수 없음');
	return withTempDir(async (dir) => {
		const inPath = path.join(dir, 'in.pdf');
		await writeFile(inPath, pdf);
		const args = ['-r', String(dpi), '-png', '-f', '1'];
		if (last !== null) args.push('-l', String(last));
		args.push(inPath, path.join(dir, 'pg'));
		const r = await run('pdftoppm', args, { timeoutMs: 180_000, cwd: dir });
		if (r.code !== 0) fail('PDF 페이지 렌더 실패');
		const files = (await readdir(dir)).filter((f) => /^pg-\d+\.png$/.test(f));
		files.sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]));
		if (files.length === 0) fail('PDF 렌더 결과 이미지가 없음');
		return Promise.all(files.map((f) => readFile(path.join(dir, f))));
	});
}
