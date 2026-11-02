import JSZip from 'jszip';
import { test, expect, axe, shot, type Page } from './fixtures.ts';

const CSV = Buffer.from('과제번호,과제명,마감일\nR-1,가,2026-11-20\nR-2,나,2027-03-01\n');
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64'
);

async function sampleZip(): Promise<Buffer> {
	const z = new JSZip();
	z.file('2026/마감 목록.csv', CSV);
	z.file('2026/메모.txt', 'not supported');
	return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Build File objects in the page and fire a real drop / paste event carrying them. */
async function fire(page: Page, kind: 'dragenter' | 'drop' | 'paste', files: { name: string; type: string; b64: string }[], text = '') {
	await page.evaluate(
		({ kind, files, text }) => {
			const dt = new DataTransfer();
			for (const f of files) {
				const bin = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
				dt.items.add(new File([bin], f.name, { type: f.type }));
			}
			if (text) dt.setData('text/plain', text);
			if (kind === 'dragenter' || kind === 'drop') {
				const card = document.querySelector('[data-testid="prompt-card"]')!;
				const types = kind === 'dragenter' ? ['dragenter', 'dragover'] : ['drop'];
				for (const t of types) card.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
			} else {
				const ta = document.getElementById('prompt')!;
				ta.focus();
				ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
			}
		},
		{ kind, files, text }
	);
}

async function uploadIds(page: Page): Promise<string[]> {
	const r = await page.request.get('/api/uploads');
	return ((await r.json()).data.items as { id: string }[]).map((i) => i.id);
}

test.describe('attach files from the PC on home', () => {
	test('+ button: allowed file uploads, unsupported one is refused, request uses the attachment', async ({ admin }) => {
		await admin.goto('/');
		await expect(admin.getByRole('button', { name: 'PC에서 파일 첨부' })).toBeVisible();
		await admin.getByTestId('attach-input').setInputFiles([
			{ name: '연구 마감.csv', mimeType: 'text/csv', buffer: CSV },
			{ name: '보고서.txt', mimeType: 'application/octet-stream', buffer: Buffer.from('x') }
		]);
		await expect(admin.getByTestId('attach-errors')).toContainText('"보고서.txt": 첨부할 수 없는 형식');
		const chip = admin.getByTestId('attachment');
		await expect(chip).toHaveCount(1);
		await expect(chip).toHaveAttribute('data-status', 'done');
		await expect(chip).toContainText('연구 마감.csv');
		await expect(chip).toContainText('첨부됨');

		await admin.getByTestId('prompt-input').fill('첨부한 파일에서 오늘부터 30일 이내 마감 과제를 정리해줘');
		await admin.getByTestId('prompt-submit').click();
		await admin.waitForURL(/\/drafts\/[0-9a-f-]{36}$/);
		await expect(admin.locator('#sources').getByText('파일 1. 연구 마감.csv', { exact: true })).toBeVisible();
		await expect(admin.locator('#sources')).toContainText('PC에서 첨부한 파일');
		// No "which file?" question: the attachment is the source.
		await expect(admin.getByTestId('questions')).not.toContainText('어떤 허용 파일');
	});

	test('drag and drop: overlay appears, a ZIP is unpacked and skipped entries are listed', async ({ admin }) => {
		await admin.goto('/');
		await expect(admin.getByTestId('prompt-input')).toBeVisible();
		const zip = await sampleZip();
		const files = [{ name: '자료.zip', type: 'application/zip', b64: zip.toString('base64') }];
		await fire(admin, 'dragenter', files);
		await expect(admin.getByTestId('drop-overlay')).toContainText('여기에 놓으면 첨부됩니다');
		await shot(admin, 'home-drop-overlay');
		await fire(admin, 'drop', files);
		await expect(admin.getByTestId('drop-overlay')).toHaveCount(0);
		const chip = admin.getByTestId('attachment');
		await expect(chip).toHaveAttribute('data-status', 'done');
		await expect(chip).toContainText('압축을 풀어 파일 1개 첨부 · 1개 제외');
		await expect(admin.getByTestId('zip-contents')).toContainText('2026/마감 목록.csv');
		await expect(admin.getByTestId('zip-contents')).toContainText('제외: 2026/메모.txt — 지원하지 않는 형식');
		await shot(admin, 'home-attachments-zip');
		await axe(admin);

		// Removing the attachment deletes the stored original.
		const before = await uploadIds(admin);
		await admin.getByRole('button', { name: '자료.zip 첨부 빼기' }).click();
		await expect(admin.getByTestId('attachment')).toHaveCount(0);
		await expect.poll(async () => (await uploadIds(admin)).length).toBe(before.length - 1);
	});

	test('Ctrl+V: a pasted screenshot is attached; clipboard text is left to the normal paste', async ({ admin }) => {
		await admin.goto('/');
		await expect(admin.getByTestId('prompt-input')).toBeVisible();
		await fire(admin, 'paste', [{ name: 'image.png', type: 'image/png', b64: PNG.toString('base64') }]);
		const chip = admin.getByTestId('attachment');
		await expect(chip).toHaveAttribute('data-status', 'done');
		await expect(chip).toContainText(/붙여넣은 이미지 \d{8}-\d{6}\.png/);

		// Cells copied from Excel carry text plus a picture: only the text paste applies.
		await fire(admin, 'paste', [{ name: 'image.png', type: 'image/png', b64: PNG.toString('base64') }], '과제번호\t마감일');
		await expect(admin.getByTestId('attachment')).toHaveCount(1);
	});

	test('a file renamed to an allowed extension is refused by the server with a clear reason', async ({ admin }) => {
		await admin.goto('/');
		await admin.getByTestId('attach-input').setInputFiles([{ name: '가짜.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('hello') }]);
		const chip = admin.getByTestId('attachment');
		await expect(chip).toHaveAttribute('data-status', 'error');
		await expect(chip).toContainText('.xlsx 형식이 아닙니다');
		await admin.getByTestId('prompt-input').fill('정리해줘');
		await admin.getByTestId('prompt-submit').click();
		await expect(admin.locator('#prompt-error')).toContainText('업로드하지 못한 파일이 있습니다');
	});
});
