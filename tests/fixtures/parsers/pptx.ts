/** pptx fixtures authored with pptxgenjs. */
import pptxgen from 'pptxgenjs';
import { textPng } from './images';

export const IMAGE_LINES = ['INVOICE 4821', '납부 기한 확인'];

/**
 * 1 text (runs split across formatting, leading-zero code) + notes
 * 2 table
 * 3 chart (cached values)
 * 4 image with text (OCR)
 * 5 hidden slide
 * 6 final text slide
 */
export async function deck(): Promise<Buffer> {
	const p = new pptxgen();
	p.layout = 'LAYOUT_WIDE';

	const s1 = p.addSlide();
	s1.addText('분기 보고서 Quarterly Report', { x: 0.5, y: 0.3, w: 12, h: 0.8, fontSize: 28 });
	s1.addText(
		[
			{ text: 'Total ', options: {} },
			{ text: '1,234', options: { bold: true } },
			{ text: ' units', options: { italic: true } }
		],
		{ x: 0.5, y: 1.5, w: 12, h: 0.8, fontSize: 20 }
	);
	s1.addText('Code 00123', { x: 0.5, y: 2.5, w: 6, h: 0.6, fontSize: 18 });
	s1.addText('0042', { x: 0.5, y: 3.3, w: 6, h: 0.6, fontSize: 18 });
	s1.addNotes('발표자 메모: speaker-only note 77');

	const s2 = p.addSlide();
	s2.addTable(
		[
			[{ text: 'Item' }, { text: 'Qty' }, { text: 'Code' }],
			[{ text: 'bolt' }, { text: '5' }, { text: '00123' }],
			[{ text: 'nut' }, { text: '7.50' }, { text: '0042' }]
		],
		{ x: 0.5, y: 0.5, w: 8 }
	);

	const s3 = p.addSlide();
	s3.addChart(p.ChartType.bar, [{ name: 'Revenue', labels: ['001', 'Q2', 'Q3'], values: [1.5, 2.25, 3] }], {
		x: 0.5,
		y: 0.5,
		w: 8,
		h: 5,
		showTitle: true,
		title: 'Sales chart',
		valAxisLabelFormatCode: '0.00"억원"'
	});

	const s4 = p.addSlide();
	const png = await textPng(IMAGE_LINES, { width: 900, height: 240, fontSize: 40 });
	s4.addImage({ data: `image/png;base64,${png.toString('base64')}`, x: 0.5, y: 0.5, w: 10, h: 2.5 });

	const s5 = p.addSlide();
	s5.hidden = true;
	s5.addText('Hidden slide content', { x: 0.5, y: 0.5, w: 8, h: 1 });

	const s6 = p.addSlide();
	s6.addText('Final slide', { x: 0.5, y: 0.5, w: 8, h: 1 });

	return (await p.write({ outputType: 'nodebuffer' })) as Buffer;
}

/** Text-only deck (fast to convert) used for legacy ppt checks. */
export async function simpleDeck(): Promise<Buffer> {
	const p = new pptxgen();
	const s1 = p.addSlide();
	s1.addText('Legacy deck 레거시 슬라이드', { x: 0.5, y: 0.5, w: 8, h: 1 });
	s1.addNotes('legacy note');
	const s2 = p.addSlide();
	s2.addTable(
		[
			[{ text: 'Name' }, { text: 'Score' }],
			[{ text: 'kim' }, { text: '90' }]
		],
		{ x: 0.5, y: 0.5, w: 6 }
	);
	return (await p.write({ outputType: 'nodebuffer' })) as Buffer;
}
