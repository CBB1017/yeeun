/**
 * Word fixtures (test-time only).
 * - `fodt()`: a Flat ODT written here, converted by LibreOffice to real .docx / .doc.
 * - `handDocx()`: a minimal WordprocessingML zip for tracked changes, fields,
 *   text boxes (mc:AlternateContent), comments, footnotes and gridSpan/vMerge.
 * - `encryptedOoxml()`: CFB container with EncryptionInfo/EncryptedPackage streams
 *   (structure of an encrypted OOXML file; payload is not real ciphertext).
 */
import JSZip from 'jszip';
import * as CFB from 'cfb';
import { textPng } from './images';

export const DOC_IMAGE_LINES = ['INVOICE 4821', '납부 기한 확인'];

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const cell = (t: string, extra = '') => `<table:table-cell office:value-type="string"${extra}><text:p>${esc(t)}</text:p></table:table-cell>`;

export async function fodt(): Promise<Buffer> {
	const png = await textPng(DOC_IMAGE_LINES, { width: 900, height: 240, fontSize: 40 });
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">
<office:styles>
<style:style style:name="Standard" style:family="paragraph" style:class="text"/>
<style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph" style:parent-style-name="Standard" style:default-outline-level="1" style:class="text"/>
</office:styles>
<office:automatic-styles>
<style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin="2cm"/><style:header-style/><style:footer-style/></style:page-layout>
</office:automatic-styles>
<office:master-styles>
<style:master-page style:name="Standard" style:page-layout-name="pm1">
<style:header><text:p>머리글 HEADER-TXT</text:p></style:header>
<style:footer><text:p>바닥글 FOOTER-TXT</text:p></style:footer>
</style:master-page>
</office:master-styles>
<office:body><office:text>
<text:h text:style-name="Heading_20_1" text:outline-level="1">개요 Overview</text:h>
<text:p text:style-name="Standard">첫 문단 First paragraph.</text:p>
<text:p text:style-name="Standard">탭<text:tab/>구분 and line<text:line-break/>break</text:p>
<text:p text:style-name="Standard">각주가 있는 문장<text:note text:id="ftn1" text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>각주 FOOTNOTE-1</text:p></text:note-body></text:note></text:p>
<table:table table:name="T1">
<table:table-column table:number-columns-repeated="3"/>
<table:table-row>${cell('품목')}${cell('코드')}${cell('수량')}</table:table-row>
<table:table-row>${cell('볼트')}${cell('00123')}${cell('5')}</table:table-row>
<table:table-row>${cell('너트 세트', ' table:number-columns-spanned="2"')}<table:covered-table-cell/>${cell('7.50', ' table:number-rows-spanned="2"')}</table:table-row>
<table:table-row>${cell('와셔')}${cell('0042')}<table:covered-table-cell/></table:table-row>
</table:table>
<text:p text:style-name="Standard">표 다음 After table</text:p>
<text:p text:style-name="Standard"><draw:frame draw:name="img1" text:anchor-type="as-char" svg:width="9cm" svg:height="2.4cm"><draw:image><office:binary-data>${png.toString('base64')}</office:binary-data></draw:image></draw:frame></text:p>
<text:p text:style-name="Standard">마지막 문단 Last.</text:p>
</office:text></office:body>
</office:document>`;
	return Buffer.from(xml, 'utf8');
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const NS_EXTRA =
	'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';

const R = (t: string) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
const tc = (t: string, pr = '') => `<w:tc><w:tcPr>${pr}</w:tcPr><w:p>${t ? R(t) : ''}</w:p></w:tc>`;

export interface HandDocxOptions {
	altChunk?: boolean;
}

export async function handDocx(o: HandDocxOptions = {}): Promise<Buffer> {
	const body = [
		`<w:p><w:pPr><w:pStyle w:val="1"/></w:pPr>${R('제목 Title')}</w:p>`,
		`<w:p>${R('Hello ')}<w:ins w:id="1" w:author="a"><w:r><w:t xml:space="preserve">inserted </w:t></w:r></w:ins><w:del w:id="2" w:author="a"><w:r><w:delText xml:space="preserve">deleted </w:delText></w:r></w:del>${R('world')}<w:r><w:tab/><w:t>0012</w:t><w:br/><w:t>끝 &#xAC00;</w:t></w:r></w:p>`,
		`<w:p/>`,
		`<w:p><w:hyperlink r:id="rIdLink">${R('링크 link')}</w:hyperlink>${R(' / ')}<w:fldSimple w:instr=" NUMPAGES ">${R('42')}</w:fldSimple>${R(' / ')}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${R('7')}<w:r><w:fldChar w:fldCharType="end"/></w:r><w:commentRangeStart w:id="0"/>${R(' 메모 대상')}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>`,
		`<w:p>${R('상자 앞')}<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><a:graphic><a:graphicData><wps:wsp><wps:txbx><w:txbxContent><w:p>${R('텍스트상자 TEXTBOX')}</w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent><w:p>${R('텍스트상자 TEXTBOX')}</w:p></w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`,
		`<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid>`,
		`<w:tr>${tc('A')}${tc('B')}${tc('C')}</w:tr>`,
		`<w:tr>${tc('merged AB', '<w:gridSpan w:val="2"/>')}${tc('00123')}</w:tr>`,
		`<w:tr>${tc('v1', '<w:vMerge w:val="restart"/>')}${tc('b3')}${tc('3.5')}</w:tr>`,
		`<w:tr>${tc('', '<w:vMerge/>')}${tc('b4')}${tc('2026-11-30')}</w:tr>`,
		`<w:tr><w:trPr><w:del w:id="3" w:author="a"/></w:trPr>${tc('deleted row')}${tc('x')}${tc('y')}</w:tr>`,
		`</w:tbl>`,
		`<w:p>${R('수식 ')}<m:oMath><m:r><m:t>x=1</m:t></m:r></m:oMath><w:r><w:sym w:font="Wingdings" w:char="F0FC"/></w:r>${R('각주 문장')}<w:r><w:footnoteReference w:id="1"/></w:r></w:p>`,
		o.altChunk ? `<w:altChunk r:id="rIdAlt"/>` : '',
		`<w:sectPr/>`
	].join('');
	const zip = new JSZip();
	zip.file(
		'[Content_Types].xml',
		`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
	);
	zip.file(
		'_rels/.rels',
		`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
	);
	zip.file(
		'word/_rels/document.xml.rels',
		`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
			`<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
			`<Relationship Id="rIdC" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>` +
			`<Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>` +
			`<Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.test/" TargetMode="External"/>` +
			(o.altChunk ? `<Relationship Id="rIdAlt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="chunk.html"/>` : '') +
			`</Relationships>`
	);
	zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W} ${NS_EXTRA}><w:body>${body}</w:body></w:document>`);
	zip.file(
		'word/styles.xml',
		`<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`
	);
	zip.file(
		'word/comments.xml',
		`<?xml version="1.0" encoding="UTF-8"?><w:comments ${W}><w:comment w:id="0" w:author="a"><w:p>${R('COMMENT-ONLY')}</w:p></w:comment></w:comments>`
	);
	zip.file(
		'word/footnotes.xml',
		`<?xml version="1.0" encoding="UTF-8"?><w:footnotes ${W}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r>${R(' 각주 HAND-FN')}</w:p></w:footnote></w:footnotes>`
	);
	if (o.altChunk) zip.file('word/chunk.html', '<html><body>ALT CHUNK</body></html>');
	return zip.generateAsync({ type: 'nodebuffer' });
}

/** CFB container laid out like an encrypted OOXML package (EncryptionInfo + EncryptedPackage). */
export function encryptedOoxml(): Buffer {
	const utils = CFB.utils as unknown as {
		cfb_new(): CFB.CFB$Container;
		cfb_add(c: CFB.CFB$Container, name: string, content: Buffer): void;
	};
	const c = utils.cfb_new();
	utils.cfb_add(c, '/EncryptionInfo', Buffer.from([4, 0, 4, 0, 0x40, 0, 0, 0]));
	utils.cfb_add(c, '/EncryptedPackage', Buffer.alloc(4096, 0x5a));
	return Buffer.from(CFB.write(c, { type: 'buffer' }) as Uint8Array);
}
