/**
 * Programmatic xlsx/xlsm fixtures. ExcelJS writes the workbook; parts ExcelJS
 * cannot author (1904 flag, chart parts, VBA project) are injected into the zip.
 */
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const DAY = 86_400_000;

/** Excel serial for a calendar date in the 1900 (default) or 1904 date system. */
export function serial(ymd: string, date1904: boolean): number {
	const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
	const days = (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / DAY;
	return date1904 ? days - 1462 : days;
}

export interface MainWorkbookOptions {
	date1904?: boolean;
	/** How the 1904 flag is spelled in workbook.xml (Excel writes "1", LibreOffice writes "true"). */
	date1904Attr?: '1' | 'true';
	chart?: boolean;
}

/**
 * Sheet "Data": merged header A1:B1 ("Period"), duplicate header "Amount" (C1, D1),
 * date column E, formula columns F (cached), G (no cached value), H (stale cache),
 * I (cached error); row 4 hidden. Sheet "Second": simple 2-column table (+ chart).
 * Sheet "Early" (1900 system only): pre-1900-03-01 serials incl. the fictitious 1900-02-29.
 */
export async function mainWorkbook(opts: MainWorkbookOptions = {}): Promise<Buffer> {
	const date1904 = opts.date1904 ?? false;
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet('Data');
	ws.getCell('A1').value = 'Period';
	ws.mergeCells('A1:B1');
	ws.getCell('C1').value = 'Amount';
	ws.getCell('D1').value = 'Amount';
	ws.getCell('E1').value = 'Due';
	ws.getCell('F1').value = 'Double';
	ws.getCell('G1').value = 'Uncomputed';
	ws.getCell('H1').value = 'Stale';
	ws.getCell('I1').value = 'Err';
	const rows: [string, string, number, number, string][] = [
		['2026-Q1', '00123', 1234.5, 7, '2026-11-30'],
		['2026-Q2', '00456', 10, 8, '2024-02-29'],
		['2026-Q3 hidden', '00789', 20, 9, '1999-12-31'],
		['2026-Q4', '01000', 30, 10, '2027-01-01']
	];
	rows.forEach((r, i) => {
		const n = i + 2;
		ws.getCell(`A${n}`).value = r[0];
		ws.getCell(`B${n}`).value = r[1];
		ws.getCell(`C${n}`).value = r[2];
		ws.getCell(`D${n}`).value = r[3];
		const e = ws.getCell(`E${n}`);
		e.value = serial(r[4], date1904);
		e.numFmt = 'yyyy-mm-dd';
		ws.getCell(`F${n}`).value = { formula: `C${n}*2`, result: r[2] * 2 } as ExcelJS.CellFormulaValue;
		ws.getCell(`G${n}`).value = { formula: `C${n}+1` } as ExcelJS.CellFormulaValue;
		ws.getCell(`H${n}`).value = { formula: `C${n}*3`, result: 999 } as ExcelJS.CellFormulaValue;
		ws.getCell(`I${n}`).value = { formula: `1/0`, result: { error: '#DIV/0!' } } as unknown as ExcelJS.CellFormulaValue;
	});
	ws.getRow(4).hidden = true;

	const s2 = wb.addWorksheet('Second');
	s2.addRow(['Quarter', 'Revenue']);
	s2.addRow(['001', 1.5]);
	s2.addRow(['Q2', 2.25]);
	s2.addRow(['Q3', 3]);

	if (!date1904) {
		const s3 = wb.addWorksheet('Early');
		s3.addRow(['Label', 'When']);
		for (const [label, v] of [
			['jan15', 15],
			['feb28', 59],
			['fake-feb29', 60],
			['mar1', 61]
		] as const) {
			const r = s3.addRow([label, v]);
			r.getCell(2).numFmt = 'yyyy-mm-dd';
		}
	}

	const zip = await JSZip.loadAsync(Buffer.from(await wb.xlsx.writeBuffer()));
	if (date1904) await setDate1904(zip, opts.date1904Attr ?? '1');
	if (opts.chart) await injectChart(zip, 'xl/worksheets/sheet2.xml');
	return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function setDate1904(zip: JSZip, attr: string): Promise<void> {
	const f = 'xl/workbook.xml';
	let x = await zip.file(f)!.async('string');
	if (/<workbookPr\b/.test(x)) x = x.replace(/<workbookPr\b/, `<workbookPr date1904="${attr}"`);
	else x = x.replace(/(<workbook\b[^>]*>)/, `$1<workbookPr date1904="${attr}"/>`);
	zip.file(f, x);
}

const CHART_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:chart>
<c:title><c:tx><c:rich><a:bodyPr rot="0"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400" b="1"/></a:pPr><a:r><a:rPr lang="ko-KR" sz="1400"/><a:t>분기 매출 (억원)</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/>
<c:plotArea><c:layout/>
<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>
<c:ser><c:idx val="0"/><c:order val="0"/>
<c:tx><c:strRef><c:f>Second!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Revenue</c:v></c:pt></c:strCache></c:strRef></c:tx>
<c:cat><c:strRef><c:f>Second!$A$2:$A$4</c:f><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>001</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt><c:pt idx="2"><c:v>Q3</c:v></c:pt></c:strCache></c:strRef></c:cat>
<c:val><c:numRef><c:f>Second!$B$2:$B$4</c:f><c:numCache><c:formatCode>#,##0.00"억원"</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>1.50</c:v></c:pt><c:pt idx="1"><c:v>2.25</c:v></c:pt><c:pt idx="2"><c:v>3</c:v></c:pt></c:numCache></c:numRef></c:val>
</c:ser>
<c:axId val="111"/><c:axId val="222"/></c:barChart>
<c:catAx><c:axId val="111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="222"/></c:catAx>
<c:valAx><c:axId val="222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:numFmt formatCode="#,##0.00&quot;억원&quot;" sourceLinked="1"/><c:crossAx val="111"/></c:valAx>
</c:plotArea>
<c:plotVisOnly val="1"/>
</c:chart>
</c:chartSpace>`;

const DRAWING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<xdr:twoCellAnchor>
<xdr:from><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>10</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>16</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic>
</xdr:graphicFrame><xdr:clientData/>
</xdr:twoCellAnchor>
</xdr:wsDr>`;

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function relsFile(entries: { id: string; type: string; target: string }[]): string {
	return (
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}">` +
		entries.map((e) => `<Relationship Id="${e.id}" Type="${e.type}" Target="${e.target}"/>`).join('') +
		`</Relationships>`
	);
}

async function addRel(zip: JSZip, relsPath: string, id: string, type: string, target: string): Promise<void> {
	const f = zip.file(relsPath);
	if (!f) {
		zip.file(relsPath, relsFile([{ id, type, target }]));
		return;
	}
	const x = await f.async('string');
	zip.file(relsPath, x.replace('</Relationships>', `<Relationship Id="${id}" Type="${type}" Target="${target}"/></Relationships>`));
}

async function addContentType(zip: JSZip, xml: string): Promise<void> {
	const f = '[Content_Types].xml';
	const x = await zip.file(f)!.async('string');
	zip.file(f, x.replace('</Types>', `${xml}</Types>`));
}

/** Wire a real chart part to a worksheet: sheet -> drawing -> chart (with caches). */
export async function injectChart(zip: JSZip, sheetPath: string): Promise<void> {
	zip.file('xl/charts/chart1.xml', CHART_XML);
	zip.file('xl/drawings/drawing1.xml', DRAWING_XML);
	zip.file('xl/drawings/_rels/drawing1.xml.rels', relsFile([{ id: 'rId1', type: `${RT}/chart`, target: '../charts/chart1.xml' }]));
	const sheetRels = sheetPath.replace(/([^/]+)$/, '_rels/$1.rels');
	await addRel(zip, sheetRels, 'rIdDrw1', `${RT}/drawing`, '../drawings/drawing1.xml');
	let sx = await zip.file(sheetPath)!.async('string');
	if (!/xmlns:r=/.test(sx)) sx = sx.replace('<worksheet ', `<worksheet xmlns:r="${RT}" `);
	const anchor = /<(legacyDrawing|tableParts|extLst)\b/.exec(sx);
	const tag = '<drawing r:id="rIdDrw1"/>';
	sx = anchor ? sx.slice(0, anchor.index) + tag + sx.slice(anchor.index) : sx.replace('</worksheet>', `${tag}</worksheet>`);
	zip.file(sheetPath, sx);
	await addContentType(
		zip,
		'<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' +
			'<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
	);
}

/** Macro-enabled workbook: a vbaProject part with an auto-run style macro body. It must never execute. */
export async function xlsmWorkbook(): Promise<Buffer> {
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet('Macro');
	ws.addRow(['Item', 'Qty']);
	ws.addRow(['bolt', 5]);
	const zip = await JSZip.loadAsync(Buffer.from(await wb.xlsx.writeBuffer()));
	const vba = Buffer.concat([
		Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
		Buffer.from('Attribute VB_Name = "ThisWorkbook"\r\nSub Workbook_Open()\r\n  Shell "touch /tmp/yeeun-macro-ran"\r\nEnd Sub\r\n')
	]);
	zip.file('xl/vbaProject.bin', vba);
	await addRel(
		zip,
		'xl/_rels/workbook.xml.rels',
		'rIdVba1',
		'http://schemas.microsoft.com/office/2006/relationships/vbaProject',
		'vbaProject.bin'
	);
	const ctPath = '[Content_Types].xml';
	let ct = await zip.file(ctPath)!.async('string');
	ct = ct.replace(
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
		'application/vnd.ms-excel.sheet.macroEnabled.main+xml'
	);
	ct = ct.replace('</Types>', '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>');
	zip.file(ctPath, ct);
	return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
