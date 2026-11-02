import { defaultSelector, emptyPlan, type OutputFormat, type PlanQuestion, type TaskPlan } from '../../shared/plan';

/**
 * Deterministic first-pass interpretation of a natural-language request into
 * a reviewable TaskPlan draft. It never invents defaults the user did not ask
 * for (no research workflow, weekdays, times or holiday rules) and turns
 * every material ambiguity into a question. No CLI usage, no shell.
 */

export interface GrantCandidate {
	id: string;
	providerFileId: string;
	name: string;
	mimeType: string;
	modifiedAt: Date | null;
	folderLabel: string | null;
}

/** A file the user attached to this request from their PC. */
export interface UploadCandidate {
	id: string;
	displayName: string;
	mimeType: string;
}

const WEEKDAY: Record<string, number> = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, 일: 7 };
const EN_WEEKDAY: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

function range(a: number, b: number): number[] {
	const out: number[] = [];
	for (let d = a; ; d = (d % 7) + 1) {
		out.push(d);
		if (d === b || out.length > 7) break;
	}
	return out;
}

export function parseWeekdays(text: string): number[] | null {
	if (/매일|every ?day|daily/i.test(text)) return [1, 2, 3, 4, 5, 6, 7];
	if (/평일|weekdays/i.test(text)) return [1, 2, 3, 4, 5];
	if (/주말|weekends?/i.test(text)) return [6, 7];
	const r = /([월화수목금토일])(?:요일)?\s*(?:~|-|부터|에서)\s*([월화수목금토일])(?:요일)?(?:까지)?/.exec(text);
	if (r) return range(WEEKDAY[r[1]!]!, WEEKDAY[r[2]!]!);
	const en = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*(?:-|to|through|~)\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*/i.exec(text);
	if (en) return range(EN_WEEKDAY[en[1]!.toLowerCase()]!, EN_WEEKDAY[en[2]!.toLowerCase()]!);
	const list = [...text.matchAll(/([월화수목금토일])요일/g)].map((m) => WEEKDAY[m[1]!]!);
	if (list.length) return [...new Set(list)].sort();
	return null;
}

export function parseTimes(text: string): string[] {
	const out = new Set<string>();
	for (const m of text.matchAll(/(\d{1,2}):(\d{2})/g)) {
		const h = Number(m[1]);
		const mi = Number(m[2]);
		if (h < 24 && mi < 60) out.add(`${String(h).padStart(2, '0')}:${m[2]}`);
	}
	for (const m of text.matchAll(/(오전|오후)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분|\s*(반))?/g)) {
		let h = Number(m[2]);
		if (m[1] === '오후' && h < 12) h += 12;
		if (m[1] === '오전' && h === 12) h = 0;
		const mi = m[3] ? Number(m[3]) : m[4] ? 30 : 0;
		if (h < 24 && mi < 60) out.add(`${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`);
	}
	return [...out].sort();
}

function wantsSchedule(text: string): boolean {
	return /매일|매주|평일|주말|요일|every|daily|weekly|정기|예약|마다|[월화수목금토일]\s*(?:~|-|부터)/.test(text);
}

function outputs(text: string): OutputFormat[] {
	const f = new Set<OutputFormat>();
	if (/엑셀|excel|xlsx/i.test(text)) f.add('xlsx');
	if (/\bcsv\b/i.test(text)) f.add('csv');
	if (/\btsv\b/i.test(text)) f.add('tsv');
	if (/pdf/i.test(text)) f.add('pdf');
	if (/파워포인트|ppt|슬라이드|발표\s*자료/i.test(text)) f.add('pptx');
	if (/\bpng\b|이미지로/i.test(text)) f.add('png');
	if (/jpe?g/i.test(text)) f.add('jpeg');
	return [...f];
}

function windowDays(text: string): number | null {
	const m = /(\d{1,3})\s*일\s*(?:이내|안|동안|내)/.exec(text) ?? /within\s+(\d{1,3})\s+days/i.exec(text);
	if (m) return Number(m[1]);
	if (/한\s*달|1\s*개월|one month|30\s*days/i.test(text)) return 30;
	if (/일주일|1\s*주|one week/i.test(text)) return 7;
	return null;
}

const STOP = new Set(['파일', '엑셀', '자료', '분석', '해줘', '알려줘', '목록', '정리', 'the', 'file', 'and', '에서', '중', '것']);

function tokens(s: string): string[] {
	return s
		.toLowerCase()
		.normalize('NFC')
		.replace(/\.[a-z0-9]{2,5}$/, '')
		.split(/[^\p{L}\p{N}]+/u)
		.filter((t) => t.length >= 2 && !STOP.has(t));
}

export function matchFiles(prompt: string, grants: GrantCandidate[]): GrantCandidate[] {
	const pt = tokens(prompt);
	const scored = grants
		.map((g) => {
			const gt = tokens(g.name);
			const score = gt.filter((t) => pt.some((p) => p.includes(t) || t.includes(p))).length;
			return { g, score };
		})
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score);
	if (!scored.length) return [];
	const best = scored[0]!.score;
	return scored.filter((x) => x.score === best).map((x) => x.g);
}

export function interpret(prompt: string, grants: GrantCandidate[], browserTimezone: string, uploads: UploadCandidate[] = []): TaskPlan {
	const text = prompt.trim();
	const plan = emptyPlan(text, browserTimezone);
	const q: PlanQuestion[] = [];
	plan.title = text.split(/[.\n]/)[0]!.slice(0, 60) || '새 업무';
	plan.goal = text;
	plan.outputs.downloads = outputs(text);
	if (/메일|이메일|email/i.test(text)) plan.notifications.email = true;
	if (/푸시|push|브라우저\s*알림/i.test(text)) plan.notifications.push = true;

	// Files attached to this request are the sources, in the order attached.
	// Otherwise: only among the user's explicitly allowed Drive files.
	const matches = uploads.length ? [] : matchFiles(text, grants);
	if (uploads.length) {
		for (const u of uploads) {
			plan.sources.push({ upload_id: u.id, name: u.displayName, mime_type: u.mimeType, selector: defaultSelector() });
		}
	} else if (matches.length === 1) {
		const g = matches[0]!;
		plan.sources.push({
			grant_id: g.id,
			provider_file_id: g.providerFileId,
			name: g.name,
			mime_type: g.mimeType,
			selector: defaultSelector()
		});
	} else if (matches.length > 1) {
		q.push({
			key: 'source',
			question: '요청과 맞는 허용 파일이 여러 개입니다. 사용할 파일을 직접 선택하세요.',
			options: matches.map((g) => ({
				value: g.id,
				label: `${g.name}${g.modifiedAt ? ` (수정 ${g.modifiedAt.toISOString().slice(0, 10)})` : ''}${g.folderLabel ? ` · ${g.folderLabel}` : ''}`
			}))
		});
	} else {
		q.push({
			key: 'source',
			question: grants.length
				? '어떤 허용 파일을 사용할까요? 목록에 없으면 Drive 파일을 먼저 추가하세요.'
				: '사용할 Drive 파일을 먼저 추가하세요 (앱은 허용한 파일만 볼 수 있습니다).',
			options: grants.slice(0, 20).map((g) => ({ value: g.id, label: g.name }))
		});
	}

	// Date window filter (e.g. deadlines within N days) — column must be confirmed.
	const days = windowDays(text);
	if (days !== null) {
		plan.operations.push({
			type: 'filter_rows',
			source_index: 0,
			column: null,
			predicate: { kind: 'date_window', start: 'reference_date', days }
		});
		q.push({
			key: 'operations.0.column',
			question: `어느 열의 날짜로 ${days}일 범위(실행 시작일 포함, 시작일+${days - 1}일까지)를 판단할까요?`,
			options: []
		});
	} else if (/목록|추출|필터|찾아|filter|list/i.test(text)) {
		q.push({ key: 'operations', question: '어떤 조건의 행을 찾을지 지정하세요 (열과 조건).', options: [] });
	} else {
		plan.operations.push({ type: 'answer', question: text, claim_keys: [] });
	}

	// Schedule: only when asked; never fill unspecified days/times.
	if (wantsSchedule(text)) {
		const weekdays = parseWeekdays(text);
		const times = parseTimes(text);
		if (weekdays && times.length) {
			plan.schedule = {
				mode: 'recurring',
				raw_text: text,
				rule: weekdays.length === 7 ? { kind: 'daily', times } : { kind: 'weekly', weekdays, times },
				timezone: browserTimezone,
				holidays: { exclude: false }
			};
			q.push({
				key: 'schedule.timezone',
				question: `예약 시간대를 ${browserTimezone}(으)로 할까요?`,
				options: [
					{ value: browserTimezone, label: browserTimezone },
					{ value: 'Asia/Seoul', label: 'Asia/Seoul' }
				]
			});
		} else {
			q.push({ key: 'schedule', question: '반복 요일과 시각을 정확히 지정하세요.', options: [] });
		}
		if (/공휴일|휴일|holiday/i.test(text)) {
			plan.limitations.push('공휴일 제외 규칙은 아직 자동 적용하지 않습니다 — 국가/달력을 지정하면 추후 지원 범위를 확인합니다.');
		}
	}
	if (/삭제|수정해서\s*원본|원본을?\s*(?:고쳐|수정|덮어)/.test(text)) {
		plan.limitations.push('원본 파일은 수정/삭제하지 않습니다. 변경 내용은 새 복사본으로 만듭니다.');
	}
	plan.unresolved_questions = q;
	return plan;
}

/** Remaining questions after the user's edits (structural completeness). */
export function remainingQuestions(plan: TaskPlan, confirmedTimezone: boolean): PlanQuestion[] {
	const q: PlanQuestion[] = [];
	if (plan.sources.length === 0) q.push({ key: 'source', question: '사용할 허용 파일을 선택하세요.', options: [] });
	if (plan.operations.length === 0) q.push({ key: 'operations', question: '수행할 작업을 지정하세요.', options: [] });
	plan.operations.forEach((op, i) => {
		if (
			(op.type === 'filter_rows' && op.predicate.kind !== 'all' && !op.column) ||
			(op.type === 'aggregate' && op.fn !== 'count' && !op.column)
		) {
			q.push({ key: `operations.${i}.column`, question: `작업 ${i + 1}에 사용할 열을 지정하세요.`, options: [] });
		}
		if ('source_index' in op && op.source_index >= plan.sources.length)
			q.push({ key: `operations.${i}.source_index`, question: `작업 ${i + 1}의 파일을 지정하세요.`, options: [] });
	});
	if (plan.schedule.mode === 'recurring' && !confirmedTimezone)
		q.push({ key: 'schedule.timezone', question: '예약 시간대를 확인하세요.', options: [] });
	if (plan.outputs.downloads.includes('csv') || plan.outputs.downloads.includes('tsv')) {
		/* encoding has a visible default (UTF-8) shown in the plan */
	}
	return q;
}

// ---------- natural-language Drive search hints ----------

const SEARCH_STOP = new Set([
	...STOP,
	'마감', '이내', '안에', '동안', '한달', '달', '일', '주', '매일', '매주', '평일', '주말', '오전', '오후', '시', '분',
	'월', '화', '수', '목', '금', '토', '요일', '메일', '이메일', '푸시', '알림', '보내줘', '보내', '찾아줘', '찾아', '만들어줘',
	'정리해줘', '요약', '요약해줘', '있는', '해당', '관련', '내', '나의', '그', '이', '저', 'pdf', 'csv', 'xlsx', 'ppt', 'pptx',
	'엑셀', 'excel', '스프레드시트', '파워포인트', '슬라이드', '문서', '시트', 'drive', '드라이브', '구글', 'google', '폴더',
	'워드', 'word', 'docx', 'doc', '한글', 'hwp', 'hwpx', '아래아'
]);
const PARTICLES = /(에서|으로|부터|까지|에게|한테|이랑|하고|처럼|보다|에는|에서의|의|을|를|은|는|이|가|에|로|와|과|도|만)$/;

export const MIME_HINTS: { re: RegExp; mimes: string[] }[] = [
	{
		re: /엑셀|excel|xlsx?|스프레드시트|시트/i,
		mimes: [
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'application/vnd.ms-excel',
			'application/vnd.google-apps.spreadsheet',
			'text/csv'
		]
	},
	{ re: /\bpdf\b/i, mimes: ['application/pdf'] },
	{
		re: /파워포인트|pptx?|슬라이드|발표\s*자료/i,
		mimes: [
			'application/vnd.openxmlformats-officedocument.presentationml.presentation',
			'application/vnd.ms-powerpoint',
			'application/vnd.google-apps.presentation'
		]
	},
	{ re: /\bcsv\b/i, mimes: ['text/csv'] },
	{
		re: /워드|\bword\b|\bdocx?\b/i,
		mimes: [
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'application/msword',
			'application/vnd.google-apps.document'
		]
	},
	{
		re: /한글\s*(파일|문서)|아래아\s*한글|\bhwpx?\b/i,
		mimes: ['application/x-hwp', 'application/haansofthwp', 'application/vnd.hancom.hwp', 'application/vnd.hancom.hwpx', 'application/hwp+zip']
	}
];

/** Keywords (file-name clues) and MIME types implied by a natural-language request. */
export function searchHints(text: string): { keywords: string[]; mimeTypes: string[] } {
	const words = text
		.normalize('NFC')
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.map((w) => w.replace(PARTICLES, ''))
		.filter((w) => w.length >= 2 && !SEARCH_STOP.has(w) && !/^\d+$/.test(w));
	const keywords = [...new Set(words)].slice(0, 6);
	const mimeTypes = [...new Set(MIME_HINTS.filter((h) => h.re.test(text)).flatMap((h) => h.mimes))];
	return { keywords, mimeTypes };
}

/** Rank Drive results by how many keywords their name contains (ties: most recently modified first). */
export function rankByKeywords<T extends { name: string }>(files: T[], keywords: string[]): T[] {
	const score = (n: string) => keywords.filter((k) => n.toLowerCase().normalize('NFC').includes(k)).length;
	return files
		.map((f, i) => ({ f, s: score(f.name), i }))
		.filter((x) => x.s > 0 || keywords.length === 0)
		.sort((a, b) => b.s - a.s || a.i - b.i)
		.map((x) => x.f);
}
