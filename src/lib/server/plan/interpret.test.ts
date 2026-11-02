import { describe, expect, it } from 'vitest';
import { interpret, parseTimes, parseWeekdays, remainingQuestions } from './interpret';
import { nextOccurrences, occurrencesBetween, planDue, nextSeoulMidnight } from '../schedule/rules';
import { TaskPlanSchema } from '../../shared/plan';

const grants = [
	{
		id: '0190f0a0-0000-7000-8000-000000000001',
		providerFileId: 'fileAAAAAAAAAA',
		name: '대학 연구과제 목록.xlsx',
		mimeType: 'x',
		modifiedAt: null,
		folderLabel: null
	},
	{
		id: '0190f0a0-0000-7000-8000-000000000002',
		providerFileId: 'fileBBBBBBBBBB',
		name: '회계 예산.xlsx',
		mimeType: 'x',
		modifiedAt: null,
		folderLabel: null
	},
	{
		id: '0190f0a0-0000-7000-8000-000000000003',
		providerFileId: 'fileCCCCCCCCCC',
		name: '연구과제 목록 2025.xlsx',
		mimeType: 'x',
		modifiedAt: null,
		folderLabel: '보관'
	}
];

describe('plan interpretation (A05/A06)', () => {
	it('research example: Mon–Thu 10/14, 30-day inclusive window, asks only what is ambiguous', () => {
		const p = interpret('월~목 오전 10시와 오후 2시에 연구과제 엑셀에서 한 달 이내 마감인 과제 목록을 메일로 보내줘', grants, 'Asia/Seoul');
		expect(TaskPlanSchema.safeParse(p).success).toBe(true);
		expect(p.schedule).toMatchObject({
			mode: 'recurring',
			rule: { kind: 'weekly', weekdays: [1, 2, 3, 4], times: ['10:00', '14:00'] },
			timezone: 'Asia/Seoul'
		});
		expect(p.operations[0]).toMatchObject({ type: 'filter_rows', predicate: { kind: 'date_window', days: 30 } });
		expect(p.notifications.email).toBe(true);
		expect(p.outputs.downloads).toContain('xlsx');
		const keys = p.unresolved_questions.map((q) => q.key);
		expect(keys).toContain('source'); // two matching research files -> user must choose
		expect(keys).toContain('operations.0.column');
		expect(keys).toContain('schedule.timezone');
		expect(p.unresolved_questions.find((q) => q.key === 'source')!.options.length).toBe(2);
	});

	it('other tasks get no research defaults, weekdays, times or holiday rules', () => {
		const p = interpret('회계 예산 파일의 총액을 알려줘', grants, 'America/New_York');
		expect(p.schedule).toEqual({ mode: 'manual' });
		expect(p.operations.some((o) => o.type === 'filter_rows')).toBe(false);
		expect(p.sources[0]?.name).toBe('회계 예산.xlsx');
		expect(p.date_policy.timezone).toBe('America/New_York');
	});

	it('recurring request without explicit days/times asks instead of inventing them', () => {
		const p = interpret('매주 연구과제 목록 정리해줘', grants, 'Asia/Seoul');
		expect(p.schedule.mode).toBe('manual');
		expect(p.unresolved_questions.some((q) => q.key === 'schedule')).toBe(true);
	});

	it('remaining questions clear only when the plan is structurally complete', () => {
		const p = interpret('회계 예산 파일 요약', grants, 'Asia/Seoul');
		expect(remainingQuestions(p, true)).toEqual([]);
		p.sources = [];
		expect(remainingQuestions(p, true).map((q) => q.key)).toContain('source');
	});

	it('parses Korean/English weekday and time expressions', () => {
		expect(parseWeekdays('평일')).toEqual([1, 2, 3, 4, 5]);
		expect(parseWeekdays('금~월')).toEqual([5, 6, 7, 1]);
		expect(parseWeekdays('mon-wed')).toEqual([1, 2, 3]);
		expect(parseTimes('오후 2시 반, 09:05, 오전 12시')).toEqual(['00:00', '09:05', '14:30']);
	});
});

describe('schedule math', () => {
	const rule = { kind: 'weekly' as const, weekdays: [1, 2, 3, 4], times: ['10:00', '14:00'] };
	it('next occurrences are in the schedule timezone', () => {
		// 2026-11-02 is a Monday. 09:00 KST = 00:00Z
		const occ = nextOccurrences(rule, 'Asia/Seoul', new Date('2026-11-02T00:00:00Z'), 3);
		expect(occ.map((d) => d.toISOString())).toEqual(['2026-11-02T01:00:00.000Z', '2026-11-02T05:00:00.000Z', '2026-11-03T01:00:00.000Z']);
	});
	it('no occurrences on Fri–Sun', () => {
		const occ = occurrencesBetween(rule, 'Asia/Seoul', new Date('2026-11-06T00:00:00Z'), new Date('2026-11-08T23:00:00Z'));
		expect(occ).toEqual([]);
	});
	it('missed occurrences coalesce into one representative', () => {
		const due = occurrencesBetween(rule, 'Asia/Seoul', new Date('2026-11-02T00:00:00Z'), new Date('2026-11-04T06:00:00Z'));
		expect(due.length).toBe(6);
		const p = planDue(due, new Date('2026-11-04T09:00:00Z'))!;
		expect(p.kind).toBe('catch_up');
		expect(p.missedCount).toBe(6);
		expect(p.representative.toISOString()).toBe('2026-11-04T05:00:00.000Z');
		const onTime = planDue(due, new Date('2026-11-04T05:00:30Z'))!;
		expect(onTime.kind).toBe('normal');
		expect(onTime.missedCount).toBe(5);
	});
	it('DST-gap local times are skipped, not shifted', () => {
		const r = { kind: 'daily' as const, times: ['02:30'] };
		const occ = occurrencesBetween(r, 'America/New_York', new Date('2026-03-07T00:00:00Z'), new Date('2026-03-10T00:00:00Z'));
		expect(occ.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-03-07', '2026-03-09']);
	});
	it('daily mute expires at the next Asia/Seoul midnight', () => {
		expect(nextSeoulMidnight(new Date('2026-11-02T14:59:59Z')).toISOString()).toBe('2026-11-02T15:00:00.000Z');
		expect(nextSeoulMidnight(new Date('2026-11-02T15:00:00Z')).toISOString()).toBe('2026-11-03T15:00:00.000Z');
	});
});

describe('Drive search hints for Word and Hangul files', () => {
	it('maps 한글 파일 / 워드 문서 to their MIME types without using them as name keywords', async () => {
		const { searchHints } = await import('./interpret');
		const h = searchHints('연구과제 공고 한글 파일에서 마감일 찾아줘');
		expect(h.mimeTypes).toContain('application/x-hwp');
		expect(h.keywords).toContain('연구과제');
		expect(h.keywords).not.toContain('한글');
		const w = searchHints('예산 워드 문서 요약해줘');
		expect(w.mimeTypes).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
		expect(w.keywords).toEqual(['예산']);
	});
});
