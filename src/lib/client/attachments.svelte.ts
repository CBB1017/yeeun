import { api, messageOf, uploadFile } from './api.ts';
import { extensionOf, type SkippedEntry, type UploadLimits, type UploadResult, type UploadedOriginal } from '#lib/shared/uploads.ts';

/**
 * Files attached to the request box from the PC (+ button, drag and drop,
 * Ctrl+V). Each file uploads right away; the request is sent with the ids of
 * the stored originals. Removing an attachment before sending deletes it.
 */

export type AttachmentStatus = 'uploading' | 'done' | 'error';

export interface Attachment {
	key: string;
	name: string;
	size: number;
	isZip: boolean;
	status: AttachmentStatus;
	progress: number;
	error: string | null;
	files: UploadedOriginal[];
	skipped: SkippedEntry[];
}

let seq = 0;

/** Chrome names pasted screenshots "image.png"; give them a recognisable name. */
export function pastedName(file: File, now = new Date()): string {
	if (file.name && !/^image\.(png|jpe?g|webp)$/i.test(file.name)) return file.name;
	const ext = extensionOf(file.name) || (file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : 'png');
	const p = (n: number) => String(n).padStart(2, '0');
	const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
	return `붙여넣은 이미지 ${stamp}.${ext}`;
}

export function fmtSize(n: number): string {
	if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1).replace(/\.0$/, '')}MB`;
	if (n >= 1024) return `${Math.round(n / 1024)}KB`;
	return `${n}B`;
}

export class Attachments {
	items = $state<Attachment[]>([]);
	limits: UploadLimits;
	#controllers = new Map<string, AbortController>();

	constructor(limits: UploadLimits) {
		this.limits = limits;
	}

	/** Files the request will use (unpacked ZIP contents count one by one; pending uploads count as one). */
	get fileCount(): number {
		return this.items.reduce((n, a) => n + (a.status === 'done' ? a.files.length : a.status === 'uploading' ? 1 : 0), 0);
	}
	get uploading(): boolean {
		return this.items.some((a) => a.status === 'uploading');
	}
	get hasErrors(): boolean {
		return this.items.some((a) => a.status === 'error');
	}
	get overLimit(): boolean {
		return this.fileCount > this.limits.maxAttachments;
	}
	get uploadIds(): string[] {
		return this.items.filter((a) => a.status === 'done').flatMap((a) => a.files.map((f) => f.id));
	}

	/** Check and start uploading. Returns messages for files that were not attached. */
	add(files: File[], opts: { renamePasted?: boolean } = {}): string[] {
		const rejected: string[] = [];
		for (const file of files) {
			const name = opts.renamePasted ? pastedName(file) : file.name;
			const ext = extensionOf(name);
			if (!this.limits.extensions.includes(ext)) {
				rejected.push(`"${name}": 첨부할 수 없는 형식입니다 (허용: ${this.limits.extensions.join(', ')})`);
				continue;
			}
			if (file.size === 0) {
				rejected.push(`"${name}": 빈 파일이거나 폴더입니다. 폴더는 zip으로 압축해 첨부하세요.`);
				continue;
			}
			if (file.size > this.limits.maxFileBytes) {
				rejected.push(`"${name}": 파일 크기 한도(${fmtSize(this.limits.maxFileBytes)})를 넘습니다`);
				continue;
			}
			if (this.items.some((a) => a.name === name && a.size === file.size && a.status !== 'error')) {
				rejected.push(`"${name}": 이미 첨부했습니다`);
				continue;
			}
			if (this.fileCount + 1 > this.limits.maxAttachments) {
				rejected.push(`"${name}": 한 요청에는 파일을 최대 ${this.limits.maxAttachments}개까지 첨부할 수 있습니다`);
				continue;
			}
			this.#start(file, name);
		}
		return rejected;
	}

	#start(file: File, name: string) {
		const key = `a${++seq}`;
		this.items.push({ key, name, size: file.size, isZip: extensionOf(name) === 'zip', status: 'uploading', progress: 0, error: null, files: [], skipped: [] });
		const ctl = new AbortController();
		this.#controllers.set(key, ctl);
		const item = () => this.items.find((a) => a.key === key);
		uploadFile<UploadResult>(file, name, {
			signal: ctl.signal,
			onProgress: (f) => {
				const a = item();
				if (a) a.progress = f;
			}
		})
			.then((r) => {
				const a = item();
				if (!a) return;
				a.status = 'done';
				a.progress = 1;
				a.files = r.files;
				a.skipped = r.skipped;
			})
			.catch((e) => {
				if ((e as Error)?.name === 'AbortError') return;
				const a = item();
				if (!a) return;
				a.status = 'error';
				a.error = messageOf(e);
			})
			.finally(() => this.#controllers.delete(key));
	}

	/** Remove an attachment; stored originals that no request uses yet are deleted. */
	async remove(key: string): Promise<string | null> {
		const a = this.items.find((x) => x.key === key);
		if (!a) return null;
		this.#controllers.get(key)?.abort();
		this.items = this.items.filter((x) => x.key !== key);
		const failed: string[] = [];
		for (const f of a.files) {
			try {
				await api(`/api/uploads/${f.id}`, { method: 'DELETE' });
			} catch (e) {
				failed.push(`${f.displayName}: ${messageOf(e)}`);
			}
		}
		return failed.length ? `첨부에서 뺐지만 저장된 파일을 지우지 못했습니다 — ${failed.join(', ')}` : null;
	}

	/** After the request was sent: keep the stored files (the draft uses them) and reset the box. */
	clear() {
		for (const c of this.#controllers.values()) c.abort();
		this.#controllers.clear();
		this.items = [];
	}
}
