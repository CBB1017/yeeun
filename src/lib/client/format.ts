import { DateTime } from 'luxon';
import type { Operation, Predicate, RunState, ScheduleRule, TaskPlan } from './types.ts';

/** Display helpers (Korean UI). Status is always expressed as text + icon, never colour alone. */

export function browserTimezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	} catch {
		return 'UTC';
	}
}

export function isValidZone(tz: string): boolean {
	return !!tz && DateTime.now().setZone(tz).isValid;
}

export function fmtDateTime(iso: string | Date | null | undefined, tz?: string): string {
	if (!iso) return '—';
	const d = typeof iso === 'string' ? DateTime.fromISO(iso) : DateTime.fromJSDate(iso);
	if (!d.isValid) return String(iso);
	return d
		.setZone(tz ?? browserTimezone())
		.setLocale('ko')
		.toFormat('yyyy-MM-dd (ccc) HH:mm');
}

export function fmtDateTimeZone(iso: string | Date | null | undefined, tz: string): string {
	if (!iso) return '—';
	return `${fmtDateTime(iso, tz)} ${tz}`;
}

export function fmtDate(iso: string | null | undefined): string {
	if (!iso) return '—';
	const d = DateTime.fromISO(iso);
	return d.isValid ? d.setLocale('ko').toFormat('yyyy-MM-dd (ccc)') : iso;
}

export function fmtBytes(n: number | null | undefined): string {
	if (n == null) return '—';
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function shortHash(h: string | null | undefined, n = 12): string {
	return h ? h.slice(0, n) : '—';
}

export type Tone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger';

export interface StateInfo {
	label: string;
	tone: Tone;
	group: 'progress' | 'review' | 'error' | 'done' | 'ended';
	description: string;
}

export const RUN_STATE: Record<RunState, StateInfo> = {
	queued: { label: '대기 중', tone: 'neutral', group: 'progress', description: '실행 순서를 기다리고 있습니다.' },
	preparing: { label: '원본 확보 중', tone: 'progress', group: 'progress', description: '허용된 Drive 파일을 가져와 스냅샷과 해시를 만들고 있습니다.' },
	executing: { label: 'CLI 분석 중', tone: 'progress', group: 'progress', description: 'Claude와 Codex가 같은 원본으로 각각 독립 분석하고 있습니다.' },
	comparing: { label: '결과 비교 중', tone: 'progress', group: 'progress', description: '두 결과를 코드 검산과 담당 CLI 대조로 비교하고 있습니다.' },
	finalizing: { label: '결과 정리 중', tone: 'progress', group: 'progress', description: '결과 표와 다운로드 파일을 만들고 검증하고 있습니다.' },
	completed: { label: '완료', tone: 'success', group: 'done', description: '두 결과가 일치하여 결과가 확정되었습니다.' },
	awaiting_review: { label: '검토 필요', tone: 'warning', group: 'review', description: '두 결과가 일치하지 않습니다. 재검토를 요청하거나 취소하세요.' },
	review_queued: { label: '재검토 대기', tone: 'progress', group: 'progress', description: '같은 최초 원본으로 2차 검토를 기다리고 있습니다.' },
	disagreed: { label: '미해결 불일치', tone: 'danger', group: 'error', description: '재검토 후에도 결과가 일치하지 않았습니다.' },
	failed: { label: '오류', tone: 'danger', group: 'error', description: '실행이 오류로 끝났습니다. 자동 재시도하지 않습니다.' },
	cancelled: { label: '취소됨', tone: 'neutral', group: 'ended', description: '실행이 취소되었습니다.' },
	interrupted: { label: '중단됨', tone: 'danger', group: 'error', description: '작업자가 멈춰 실행이 중단되었습니다. 자동 재시도하지 않습니다.' }
};

export function stateInfo(s: string): StateInfo {
	return RUN_STATE[s as RunState] ?? { label: s, tone: 'neutral', group: 'ended', description: '' };
}

export const TRIGGER_LABEL: Record<string, string> = { manual: '수동 실행', schedule: '예약 실행', catch_up: '밀린 예약 1회 실행' };
export const PROVIDER_LABEL: Record<string, string> = { claude: 'Claude', codex: 'Codex' };
export const STAGE_LABEL: Record<string, string> = {
	queued: '대기',
	preparing: '원본 확보',
	executing: 'CLI 분석',
	comparing: '결과 비교',
	finalizing: '결과 정리',
	review_queued: '재검토 대기',
	awaiting_review: '검토 대기'
};

export const ERROR_INFO: Record<string, { title: string; action: string }> = {
	AUTH_REQUIRED: { title: '로그인이 필요합니다', action: '다시 로그인하세요.' },
	INVITATION_REQUIRED: { title: '초대가 필요합니다', action: '관리자에게 초대를 요청하세요.' },
	DRIVE_REAUTH_REQUIRED: { title: 'Drive 권한이 만료되었거나 취소되었습니다', action: '파일 화면에서 Drive를 다시 연결한 뒤 새로 실행하세요.' },
	SOURCE_MISSING: { title: '원본 파일을 찾을 수 없습니다', action: '파일이 삭제·이동되었거나 접근이 취소되었습니다. 대체 파일을 자동으로 고르지 않습니다. 업무 설정에서 파일을 다시 선택하세요.' },
	SOURCE_CHANGED_DURING_CAPTURE: { title: '가져오는 중 원본이 바뀌었습니다', action: '편집이 끝난 뒤 새로 실행하세요.' },
	SOURCE_TOO_LARGE: { title: '원본이 처리 한도를 넘습니다', action: '시트나 파일 범위를 줄인 뒤 새로 실행하세요.' },
	UNSUPPORTED_FORMAT: { title: '지원하지 않는 형식입니다', action: '지원 형식으로 변환한 파일을 허용한 뒤 다시 설정하세요.' },
	PARSE_FAILED: { title: '원본을 읽지 못했습니다', action: '파일이 손상되었거나 암호가 걸려 있을 수 있습니다.' },
	CLI_UNAVAILABLE: { title: '실행 환경을 사용할 수 없습니다', action: '관리자에게 CLI 실행 환경 점검을 요청하세요.' },
	CLI_AUTH_FAILED: { title: '소유자 CLI 인증 문제', action: '관리자가 CLI 로그인을 다시 해야 합니다. 완료 후 새로 실행하세요.' },
	USAGE_LIMIT: { title: '구독 사용량 한도에 도달했습니다', action: '한도가 풀린 뒤 직접 새로 실행하세요. API 과금으로 대체하지 않습니다.' },
	NETWORK_FAILED: { title: '네트워크 오류', action: '연결 상태를 확인한 뒤 새로 실행하세요.' },
	UPSTREAM_5XX: { title: '외부 서비스 오류', action: '잠시 후 직접 새로 실행하세요.' },
	EXECUTION_FAILED: { title: '실행 오류', action: '문제가 계속되면 관리자에게 문의하세요.' },
	OUTPUT_SCHEMA_INVALID: { title: 'CLI 출력 형식 오류', action: '결과를 신뢰할 수 없어 중단했습니다. 새로 실행할 수 있습니다.' },
	TIMEOUT: { title: '제한 시간 초과', action: '범위를 줄이거나 나중에 새로 실행하세요.' },
	CANCELLED: { title: '취소됨', action: '필요하면 새로 실행하세요.' },
	INTERRUPTED: { title: '실행이 중단됨', action: '작업자가 멈췄습니다. 필요하면 새로 실행하세요.' },
	STORAGE_FAILED: { title: '저장 오류', action: '관리자에게 저장소 상태 확인을 요청하세요.' },
	DELIVERY_FAILED: { title: '전송 실패', action: '설정을 확인한 뒤 다시 보내기를 누르세요.' },
	INPUT_REQUIRED: { title: '입력이 더 필요합니다', action: '업무 설정의 남은 질문에 답하세요.' },
	CAPABILITY_UNAVAILABLE: { title: '기능을 사용할 수 없습니다', action: '관리자에게 문의하세요.' },
	NOT_CONFIGURED: { title: '운영자 설정이 필요합니다', action: '관리자에게 문의하세요.' }
};

export function errorInfo(code: string | null | undefined) {
	return ERROR_INFO[code ?? ''] ?? { title: code ?? '알 수 없는 오류', action: '문제가 계속되면 관리자에게 문의하세요.' };
}

export const RETENTION_LABEL: Record<string, string> = {
	none: '보관할 자료 없음',
	retained: '원본 스냅샷과 부분 결과를 DB와 로컬 사본에 보관함',
	file_only: '로컬 사본만 보관됨 (DB 저장 실패 — 복구 시 다시 맞춤)',
	db_only: 'DB에만 보관됨 (로컬 사본 저장 실패 — 복구 시 다시 맞춤)',
	retention_failed: '보관 실패 — 관리자에게 알리세요',
	completed: '결과 확정·보관됨'
};

export const NOTIFICATION_STATUS: Record<string, { label: string; tone: Tone }> = {
	pending: { label: '보내기 대기', tone: 'neutral' },
	sending: { label: '보내는 중', tone: 'progress' },
	sent: { label: '전송됨', tone: 'success' },
	suppressed: { label: '숨김(오늘 알림 끔)', tone: 'neutral' },
	delivery_failed: { label: '전송 실패', tone: 'danger' }
};

export const NOTIFICATION_EVENT: Record<string, string> = {
	completed: '결과 준비',
	zero_result: '0건 결과',
	review_needed: '검토 필요',
	disagreed: '미해결 불일치',
	error: '오류',
	test: '테스트'
};

export const CHANNEL_LABEL: Record<string, string> = { email: '이메일', push: '브라우저 푸시' };

export function mimeLabel(mime: string): string {
	const m = mime.toLowerCase();
	if (m.includes('google-apps.spreadsheet')) return 'Google 스프레드시트';
	if (m.includes('google-apps.presentation')) return 'Google 프레젠테이션';
	if (m.includes('google-apps.document')) return 'Google 문서';
	if (m.includes('spreadsheetml') || m.endsWith('ms-excel')) return '엑셀';
	if (m.includes('presentationml') || m.endsWith('ms-powerpoint')) return '파워포인트';
	if (m.includes('wordprocessingml') || m === 'application/msword') return '워드';
	if (m.includes('hwp') || m.includes('hancom')) return '한글';
	if (m === 'text/csv') return 'CSV';
	if (m.includes('tab-separated')) return 'TSV';
	if (m === 'application/pdf') return 'PDF';
	if (m.startsWith('image/')) return `이미지 (${m.slice(6)})`;
	return mime;
}

export const WEEKDAYS: { n: number; short: string; long: string }[] = [
	{ n: 1, short: '월', long: '월요일' },
	{ n: 2, short: '화', long: '화요일' },
	{ n: 3, short: '수', long: '수요일' },
	{ n: 4, short: '목', long: '목요일' },
	{ n: 5, short: '금', long: '금요일' },
	{ n: 6, short: '토', long: '토요일' },
	{ n: 7, short: '일', long: '일요일' }
];

export function describeRule(rule: ScheduleRule): string {
	const times = [...rule.times].sort().join(', ');
	if (rule.kind === 'daily') return `매일 ${times}`;
	const days = [...rule.weekdays].sort((a, b) => a - b).map((d) => WEEKDAYS[d - 1]?.short ?? d).join('·');
	return `매주 ${days} ${times}`;
}

/**
 * Client preview of the next occurrences (same rule semantics as the server:
 * local wall-clock times in the rule's IANA zone, strictly after `from`).
 */
export function nextOccurrences(rule: ScheduleRule, tz: string, from: Date, n: number): DateTime[] {
	if (!isValidZone(tz) || !rule.times.length) return [];
	if (rule.kind === 'weekly' && !rule.weekdays.length) return [];
	const out: DateTime[] = [];
	const start = DateTime.fromJSDate(from, { zone: tz });
	const times = [...rule.times].sort();
	let day = start.startOf('day');
	for (let i = 0; i < 400 && out.length < n; i++, day = day.plus({ days: 1 })) {
		if (rule.kind === 'weekly' && !rule.weekdays.includes(day.weekday)) continue;
		for (const t of times) {
			const [h, m] = t.split(':').map(Number);
			const at = day.set({ hour: h, minute: m, second: 0, millisecond: 0 });
			if (at.toMillis() > start.toMillis()) out.push(at);
			if (out.length >= n) break;
		}
	}
	return out;
}

export function fmtOccurrence(d: DateTime): string {
	return d.setLocale('ko').toFormat('yyyy-MM-dd (ccc) HH:mm');
}

export function windowLabel(days: number): string {
	return `시작일 포함 ${days}일 (시작일 ~ 시작일+${days - 1}일)`;
}

export function describePredicate(p: Predicate): string {
	switch (p.kind) {
		case 'all':
			return '모든 행';
		case 'date_window':
			return `실행 시작일 기준 ${windowLabel(p.days)}`;
		case 'date_between':
			return `${p.from} ~ ${p.to} (양끝 포함)`;
		case 'equals':
			return `값이 “${p.value}”와 같음`;
		case 'contains':
			return `“${p.value}” 포함`;
		case 'number_between':
			return `${p.min ?? '−∞'} 이상 ${p.max ?? '+∞'} 이하`;
	}
}

const AGG: Record<string, string> = { count: '개수', sum: '합계', avg: '평균', min: '최솟값', max: '최댓값' };

export function describeOperation(op: Operation, plan: Pick<TaskPlan, 'sources'>): string {
	const src = (i: number) => plan.sources[i]?.name ?? `파일 ${i + 1}`;
	if (op.type === 'filter_rows') return `${src(op.source_index)}에서 ${op.column ? `“${op.column}” 열이 ` : ''}${describePredicate(op.predicate)}인 행 찾기`;
	if (op.type === 'aggregate')
		return `${src(op.source_index)}의 ${op.column ? `“${op.column}” ` : ''}${AGG[op.fn]}${op.filter_column ? ` (조건: “${op.filter_column}” ${describePredicate(op.filter)})` : ''}`;
	return `질문에 답하기: ${op.question}`;
}

export const FORMAT_LABEL: Record<string, string> = {
	xlsx: '엑셀 (xlsx)',
	pptx: '파워포인트 (pptx)',
	pdf: 'PDF',
	csv: 'CSV',
	tsv: 'TSV',
	png: 'PNG 이미지',
	jpeg: 'JPEG 이미지'
};

export function isIos(): boolean {
	if (typeof navigator === 'undefined') return false;
	return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}
