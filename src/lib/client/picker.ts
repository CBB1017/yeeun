/**
 * Google Picker (drive.file). The external script is loaded only here, only
 * after the user clicks "파일 추가". It returns the ids the user picked; the
 * server then verifies each one with the user's own token.
 */

export interface PickerConfig {
	apiKey: string;
	appId: string;
	clientId: string;
	accessToken: string;
	origin: string;
}

/* Minimal typings for the parts of gapi / google.picker that are used. */
interface PickerResponse {
	action: string;
	docs?: { id: string }[];
}
interface PickerView {
	setIncludeFolders(b: boolean): PickerView;
	setSelectFolderEnabled(b: boolean): PickerView;
}
interface PickerBuilder {
	addView(v: PickerView): PickerBuilder;
	enableFeature(f: string): PickerBuilder;
	setOAuthToken(t: string): PickerBuilder;
	setDeveloperKey(k: string): PickerBuilder;
	setAppId(id: string): PickerBuilder;
	setOrigin(o: string): PickerBuilder;
	setLocale(l: string): PickerBuilder;
	setTitle(t: string): PickerBuilder;
	setCallback(cb: (r: PickerResponse) => void): PickerBuilder;
	build(): { setVisible(v: boolean): void; dispose(): void };
}
interface PickerNS {
	Action: { PICKED: string; CANCEL: string };
	Feature: { MULTISELECT_ENABLED: string };
	ViewId: { DOCS: string };
	DocsView: new (viewId?: string) => PickerView;
	PickerBuilder: new () => PickerBuilder;
}
type PickerWindow = Window & {
	gapi?: { load(name: string, cb: { callback: () => void; onerror: () => void }): void };
	google?: { picker?: PickerNS };
};

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
	if (scriptPromise) return scriptPromise;
	scriptPromise = new Promise((resolve, reject) => {
		const s = document.createElement('script');
		s.src = 'https://apis.google.com/js/api.js';
		s.async = true;
		s.onload = () => resolve();
		s.onerror = () => {
			scriptPromise = null;
			reject(new Error('Google Picker 스크립트를 불러오지 못했습니다. 네트워크를 확인하세요.'));
		};
		document.head.appendChild(s);
	});
	return scriptPromise;
}

async function loadPicker(): Promise<PickerNS> {
	await loadScript();
	const w = window as PickerWindow;
	await new Promise<void>((resolve, reject) => {
		w.gapi!.load('picker', { callback: () => resolve(), onerror: () => reject(new Error('Google Picker를 초기화하지 못했습니다')) });
	});
	return w.google!.picker!;
}

/** Opens the Picker; resolves with picked file ids, or null when the user cancels. */
export async function pickDriveFiles(cfg: PickerConfig): Promise<string[] | null> {
	const picker = await loadPicker();
	return new Promise((resolve) => {
		const view = new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(false).setSelectFolderEnabled(false);
		const p = new picker.PickerBuilder()
			.addView(view)
			.enableFeature(picker.Feature.MULTISELECT_ENABLED)
			.setOAuthToken(cfg.accessToken)
			.setDeveloperKey(cfg.apiKey)
			.setAppId(cfg.appId)
			.setOrigin(cfg.origin)
			.setLocale('ko')
			.setTitle('앱에 허용할 파일 선택')
			.setCallback((r) => {
				if (r.action === picker.Action.PICKED) {
					resolve((r.docs ?? []).map((d) => d.id));
					p.dispose();
				} else if (r.action === picker.Action.CANCEL) {
					resolve(null);
					p.dispose();
				}
			})
			.build();
		p.setVisible(true);
	});
}
