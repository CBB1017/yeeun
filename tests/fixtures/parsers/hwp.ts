/**
 * Hangul fixtures, hand-built at test time (no Hancom Office in the toolchain):
 * - `hwpx()`: OWPML zip (mimetype, content.hpf spine, header.xml styles,
 *   section0/1.xml with paragraphs, header, footnote, track-change markers,
 *   a table with cellAddr/cellSpan, and a BinData PNG).
 * - `hwp5()`: HWP 5.0 CFB written with `cfb` per the public 5.0 spec (FileHeader,
 *   DocInfo with STYLE records, raw-deflate BodyText/Section0..1 records with
 *   PARA_TEXT control characters, a table, header/footnote controls, BinData PNG).
 */
import JSZip from 'jszip';
import * as CFB from 'cfb';
import { deflateRawSync } from 'node:zlib';
import { textPng } from './images';

export const HWP_IMAGE_LINES = ['INVOICE 4821', '납부 기한 확인'];

// ---------------------------------------------------------------- HWPX

const NS =
	'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"';

const run = (inner: string) => `<hp:run charPrIDRef="0">${inner}</hp:run>`;
const para = (inner: string, style = '0') => `<hp:p id="0" paraPrIDRef="0" styleIDRef="${style}" pageBreak="0" columnBreak="0" merged="0">${inner}<hp:linesegarray/></hp:p>`;
const t = (s: string) => `<hp:t>${s}</hp:t>`;
const sub = (ps: string) => `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP">${ps}</hp:subList>`;

function hcell(text: string, col: number, row: number, colSpan = 1, rowSpan = 1): string {
	return `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="1">${sub(para(run(t(text))))}<hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="${colSpan}" rowSpan="${rowSpan}"/><hp:cellSz width="1000" height="1000"/><hp:cellMargin left="0" right="0" top="0" bottom="0"/></hp:tc>`;
}

export interface HwpxOptions {
	encrypted?: boolean;
	missingSection?: boolean;
	mimetype?: string;
}

export async function hwpx(o: HwpxOptions = {}): Promise<Buffer> {
	const png = await textPng(HWP_IMAGE_LINES, { width: 900, height: 240, fontSize: 40 });
	const table = `<hp:tbl id="1" zOrder="0" numberingType="TABLE" rowCnt="3" colCnt="3" cellSpacing="0" borderFillIDRef="1" noAdjust="0"><hp:sz width="3000" height="3000"/><hp:pos treatAsChar="1"/><hp:caption side="TOP">${sub(para(run(t('표 제목 CAPTION'))))}</hp:caption>
<hp:tr>${hcell('항목', 0, 0)}${hcell('코드', 1, 0)}${hcell('수량', 2, 0)}</hp:tr>
<hp:tr>${hcell('볼트 세트', 0, 1, 2, 1)}${hcell('0042', 2, 1, 1, 2)}</hp:tr>
<hp:tr>${hcell('너트', 0, 2)}${hcell('7.50', 1, 2)}</hp:tr>
</hp:tbl>`;
	const section0 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><hs:sec ${NS}>
${para(run('<hp:secPr/><hp:ctrl><hp:colPr/></hp:ctrl>') + run(t('1. 개요 Overview')), '1')}
${para(run(`<hp:ctrl><hp:header id="1" applyPageType="BOTH">${sub(para(run(t('머리글 HWPX-HEADER'))))}</hp:header></hp:ctrl>`) + run(t('본문 첫 문단 First')))}
${para(run('<hp:t>탭<hp:tab/>구분<hp:lineBreak/>둘째 줄</hp:t>'))}
${para(run('<hp:t>유지 <hp:deleteBegin Id="1" TcId="1"/>삭제됨<hp:deleteEnd Id="1" TcId="1"/>끝 <hp:insertBegin Id="2" TcId="2"/>삽입<hp:insertEnd Id="2" TcId="2"/></hp:t>'))}
${para(run(table))}
${para(run('<hp:pic id="2"><hc:img binaryItemIDRef="image1" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/></hp:pic>'))}
${para(run(t('각주 문장')) + run(`<hp:ctrl><hp:footNote number="1" instId="1">${sub(para(run(t('각주 HWPX-FN'))))}</hp:footNote></hp:ctrl>`))}
${para(run(t('&#xC2DC;작 0012 끝')))}
</hs:sec>`;
	const section1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><hs:sec ${NS}>${para(run(t('둘째 구역 Section two')))}</hs:sec>`;
	const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><hh:head ${NS} version="1.4" secCnt="2"><hh:refList><hh:styles itemCnt="2"><hh:style id="0" type="PARA" name="바탕글" engName="Normal"/><hh:style id="1" type="PARA" name="개요 1" engName="Outline 1"/></hh:styles></hh:refList></hh:head>`;
	const hpf = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf/" version="" unique-identifier="" id=""><opf:metadata/><opf:manifest>
<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>
<opf:item id="image1" href="BinData/image1.png" media-type="image/png" isEmbeded="1"/>
<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>
<opf:item id="section1" href="Contents/section1.xml" media-type="application/xml"/>
</opf:manifest><opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/><opf:itemref idref="section1" linear="yes"/></opf:spine></opf:package>`;
	const manifest = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">${
		o.encrypted
			? '<odf:file-entry odf:full-path="Contents/section0.xml" odf:media-type="application/xml"><odf:encryption-data odf:checksum-type="SHA1" odf:checksum="x"><odf:algorithm odf:algorithm-name="AES256"/></odf:encryption-data></odf:file-entry>'
			: ''
	}</odf:manifest>`;
	const zip = new JSZip();
	zip.file('mimetype', o.mimetype ?? 'application/hwp+zip', { compression: 'STORE' });
	zip.file('version.xml', '<?xml version="1.0" encoding="UTF-8"?><hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" major="5" minor="1"/>');
	zip.file('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?><ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container"/>');
	zip.file('META-INF/manifest.xml', manifest);
	zip.file('Contents/content.hpf', hpf);
	zip.file('Contents/header.xml', header);
	zip.file('Contents/section0.xml', o.encrypted ? Buffer.from(deflateRawSync(Buffer.from(section0)).map((b) => b ^ 0x5a)) : section0);
	if (!o.missingSection) zip.file('Contents/section1.xml', section1);
	zip.file('BinData/image1.png', png);
	return zip.generateAsync({ type: 'nodebuffer' });
}

// ---------------------------------------------------------------- HWP 5.0

const TAG = { DOCUMENT_PROPERTIES: 0x10, ID_MAPPINGS: 0x11, STYLE: 0x1a, PARA_HEADER: 0x42, PARA_TEXT: 0x43, CTRL_HEADER: 0x47, LIST_HEADER: 0x48, TABLE: 0x4d };

function rec(tag: number, level: number, data: Buffer): Buffer {
	const h = Buffer.alloc(4);
	if (data.length >= 0xfff) {
		h.writeUInt32LE((tag | (level << 10) | (0xfff << 20)) >>> 0);
		const ext = Buffer.alloc(4);
		ext.writeUInt32LE(data.length);
		return Buffer.concat([h, ext, data]);
	}
	h.writeUInt32LE((tag | (level << 10) | (data.length << 20)) >>> 0);
	return Buffer.concat([h, data]);
}

function wstr(s: string): Buffer {
	const len = Buffer.alloc(2);
	len.writeUInt16LE(s.length);
	return Buffer.concat([len, Buffer.from(s, 'utf16le')]);
}

/** One WCHAR. */
const ch = (c: number) => {
	const b = Buffer.alloc(2);
	b.writeUInt16LE(c);
	return b;
};
/** 8-WCHAR inline/extended control: code, 6 info WCHARs (ctrl id for extended ones), code. */
function ctrl8(code: number, id = '    '): Buffer {
	const b = Buffer.alloc(16);
	b.writeUInt16LE(code, 0);
	b.write(id.split('').reverse().join(''), 2, 'latin1');
	b.writeUInt16LE(code, 14);
	return b;
}
const txt = (s: string) => Buffer.from(s, 'utf16le');

function paraHeader(level: number, style = 0, nChars = 1): Buffer {
	const d = Buffer.alloc(22);
	d.writeUInt32LE(nChars, 0);
	d.writeUInt16LE(0, 8);
	d.writeUInt8(style, 10);
	return rec(TAG.PARA_HEADER, level, d);
}

/** PARA_HEADER + PARA_TEXT (paragraph end appended) + optional extra child records. */
function paragraph(level: number, text: Buffer, style = 0, extra: Buffer[] = []): Buffer {
	const body = Buffer.concat([text, ch(13)]);
	return Buffer.concat([paraHeader(level, style, body.length / 2), rec(TAG.PARA_TEXT, level + 1, body), ...extra]);
}

function ctrlHeader(level: number, id: string): Buffer {
	const d = Buffer.alloc(4);
	d.writeUInt32LE(((id.charCodeAt(0) << 24) | (id.charCodeAt(1) << 16) | (id.charCodeAt(2) << 8) | id.charCodeAt(3)) >>> 0);
	return rec(TAG.CTRL_HEADER, level, Buffer.concat([d, Buffer.alloc(40)]));
}

function listHeader(level: number, nParas: number, cell?: { col: number; row: number; colSpan: number; rowSpan: number }): Buffer {
	const d = Buffer.alloc(cell ? 47 : 8);
	d.writeUInt16LE(nParas, 0);
	d.writeUInt32LE(0x20, 4);
	if (cell) {
		d.writeUInt16LE(cell.col, 8);
		d.writeUInt16LE(cell.row, 10);
		d.writeUInt16LE(cell.colSpan, 12);
		d.writeUInt16LE(cell.rowSpan, 14);
	}
	return rec(TAG.LIST_HEADER, level, d);
}

type HCell = { text: string; col: number; row: number; colSpan?: number; rowSpan?: number };

/** Paragraph (level 0) that anchors a table control at level 1. */
function tableParagraph(rows: number, cols: number, cells: HCell[]): Buffer {
	const table = Buffer.alloc(18 + rows * 2);
	table.writeUInt32LE(0x04000006, 0);
	table.writeUInt16LE(rows, 4);
	table.writeUInt16LE(cols, 6);
	const parts = [ctrlHeader(1, 'tbl '), rec(TAG.TABLE, 2, table)];
	for (const c of cells) {
		parts.push(listHeader(2, 1, { col: c.col, row: c.row, colSpan: c.colSpan ?? 1, rowSpan: c.rowSpan ?? 1 }));
		parts.push(paragraph(2, txt(c.text)));
	}
	return paragraph(0, ctrl8(11, 'tbl '), 0, parts);
}

export interface Hwp5Options {
	compressed?: boolean;
	password?: boolean;
	distribution?: boolean;
	/** Corrupt the compressed Section0 stream. */
	corruptSection?: boolean;
	/** Cut the decompressed Section0 record stream mid-record. */
	truncatedRecords?: boolean;
	/** Table cells with overlapping addresses (structure cannot be trusted). */
	brokenTable?: boolean;
	/** Leave out Section0 so Section1 is orphaned. */
	missingSection0?: boolean;
	version?: number;
}

export async function hwp5(o: Hwp5Options = {}): Promise<Buffer> {
	const compressed = o.compressed ?? true;
	const fh = Buffer.alloc(256);
	fh.write('HWP Document File', 0, 'latin1');
	fh.writeUInt32LE(o.version ?? 0x05010100, 32);
	fh.writeUInt32LE((compressed ? 1 : 0) | (o.password ? 2 : 0) | (o.distribution ? 4 : 0), 36);

	const style = (name: string, eng: string) => rec(TAG.STYLE, 0, Buffer.concat([wstr(name), wstr(eng), Buffer.alloc(8)]));
	const docInfo = Buffer.concat([
		rec(TAG.DOCUMENT_PROPERTIES, 0, Buffer.alloc(26)),
		rec(TAG.ID_MAPPINGS, 0, Buffer.alloc(72)),
		style('바탕글', 'Normal'),
		style('개요 1', 'Outline 1')
	]);

	const cells: HCell[] = o.brokenTable
		? [
				{ text: '항목', col: 0, row: 0 },
				{ text: '코드', col: 0, row: 0 },
				{ text: '볼트', col: 1, row: 1 }
			]
		: [
				{ text: '항목', col: 0, row: 0 },
				{ text: '코드', col: 1, row: 0 },
				{ text: '수량', col: 2, row: 0 },
				{ text: '볼트 세트', col: 0, row: 1, colSpan: 2 },
				{ text: '0042', col: 2, row: 1, rowSpan: 2 },
				{ text: '너트', col: 0, row: 2 },
				{ text: '7.50', col: 1, row: 2 }
			];

	const section0 = Buffer.concat([
		// secd/cold controls in the first paragraph carry no text
		paragraph(0, Buffer.concat([ctrl8(2, 'secd'), ctrl8(2, 'cold'), txt('제1조 목적 Purpose')]), 1, [ctrlHeader(1, 'secd'), ctrlHeader(1, 'cold')]),
		paragraph(0, Buffer.concat([ctrl8(16, 'head'), txt('본문 첫 줄'), ch(10), txt('둘째 줄'), ctrl8(9), txt('탭 뒤'), ch(30), txt('묶음'), ch(24), txt('하이픈'), ch(31), txt('끝')]), 0, [
			ctrlHeader(1, 'head'),
			listHeader(2, 1),
			paragraph(2, txt('머리글 HWP-HEADER'))
		]),
		paraHeader(0), // empty paragraph (no PARA_TEXT)
		paragraph(0, txt('코드 0012 English 섞임')),
		tableParagraph(3, 3, cells),
		paragraph(0, Buffer.concat([txt('각주 문장'), ctrl8(17, 'fn  ')]), 0, [ctrlHeader(1, 'fn  '), listHeader(2, 1), paragraph(2, txt('각주 HWP-FN'))]),
		paragraph(0, Buffer.concat([txt('숨은 설명'), ctrl8(15, 'tcmt')]), 0, [ctrlHeader(1, 'tcmt'), listHeader(2, 1), paragraph(2, txt('COMMENT-ONLY'))])
	]);
	const section1 = paragraph(0, txt('둘째 구역 Section two'));

	const enc = (b: Buffer) => (compressed ? deflateRawSync(b) : b);
	let s0 = enc(o.truncatedRecords ? section0.subarray(0, section0.length - 7) : section0);
	if (o.corruptSection) s0 = Buffer.concat([Buffer.from([0xff, 0xff, 0xff]), s0.subarray(3).map((b) => b ^ 0xa5)]);

	const utils = CFB.utils as unknown as {
		cfb_new(): CFB.CFB$Container;
		cfb_add(c: CFB.CFB$Container, name: string, content: Buffer): void;
	};
	const c = utils.cfb_new();
	utils.cfb_add(c, '/FileHeader', fh);
	utils.cfb_add(c, '/DocInfo', enc(docInfo));
	if (!o.missingSection0) utils.cfb_add(c, '/BodyText/Section0', s0);
	utils.cfb_add(c, '/BodyText/Section1', enc(section1));
	const png = await textPng(HWP_IMAGE_LINES, { width: 900, height: 240, fontSize: 40 });
	utils.cfb_add(c, '/BinData/BIN0001.png', enc(png));
	return Buffer.from(CFB.write(c, { type: 'buffer' }) as Uint8Array);
}

/** First bytes of an HWP 3.x file followed by garbage (LibreOffice cannot write HWP). */
export function hwp3Garbage(): Buffer {
	return Buffer.concat([Buffer.from('HWP Document File V3.00 \x1a\x01\x02\x03\x04\x05', 'latin1'), Buffer.alloc(2048, 0x37)]);
}
