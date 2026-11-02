import { DateTime } from 'luxon';
import type { ScheduleRule } from '../../shared/plan';

/** Occurrence math in the schedule's IANA timezone (DST-safe via luxon). */

export function isValidZone(tz: string): boolean {
	return DateTime.now().setZone(tz).isValid;
}

function* candidateDays(start: DateTime): Generator<DateTime> {
	let d = start.startOf('day');
	for (let i = 0; i < 400 * 8; i++) {
		yield d;
		d = d.plus({ days: 1 });
	}
}

/** Occurrences strictly after `after` and at or before `until`, ascending. */
export function occurrencesBetween(rule: ScheduleRule, tz: string, after: Date, until: Date, cap = 10_000): Date[] {
	const out: Date[] = [];
	const startLocal = DateTime.fromJSDate(after, { zone: tz });
	const end = until.getTime();
	const times = [...rule.times].sort();
	for (const day of candidateDays(startLocal)) {
		if (day.toMillis() > end + 86_400_000) break;
		if (rule.kind === 'weekly' && !rule.weekdays.includes(day.weekday)) continue;
		for (const t of times) {
			const [h, m] = t.split(':').map(Number);
			const occ = day.set({ hour: h!, minute: m!, second: 0, millisecond: 0 });
			// Skip non-existent local times (DST gap) rather than shifting them.
			if (occ.hour !== h || occ.minute !== m) continue;
			const ms = occ.toMillis();
			if (ms > after.getTime() && ms <= end) out.push(occ.toJSDate());
			if (out.length >= cap) return out;
		}
	}
	return out;
}

export function nextOccurrences(rule: ScheduleRule, tz: string, from: Date, n: number): Date[] {
	const until = new Date(from.getTime() + 400 * 86_400_000);
	return occurrencesBetween(rule, tz, from, until, n);
}

export function nextOccurrence(rule: ScheduleRule, tz: string, from: Date): Date | null {
	return nextOccurrences(rule, tz, from, 1)[0] ?? null;
}

/** Local calendar date (YYYY-MM-DD) of an instant in a zone. */
export function localDate(at: Date, tz: string): string {
	return DateTime.fromJSDate(at, { zone: tz }).toISODate()!;
}

/** Next midnight in Asia/Seoul after `now` (daily mute expiry). */
export function nextSeoulMidnight(now: Date): Date {
	return DateTime.fromJSDate(now, { zone: 'Asia/Seoul' }).plus({ days: 1 }).startOf('day').toJSDate();
}

export interface DuePlan {
	representative: Date;
	kind: 'normal' | 'catch_up';
	missedFrom: Date | null;
	missedTo: Date | null;
	missedCount: number;
}

/**
 * Decide what to enqueue for the occurrences due since the watermark.
 * All due occurrences coalesce into ONE run represented by the latest one.
 * It is "normal" if the latest is within the grace window, else "catch_up".
 */
export function planDue(due: Date[], now: Date, graceMs = 120_000): DuePlan | null {
	if (due.length === 0) return null;
	const latest = due[due.length - 1]!;
	const missed = due.slice(0, -1);
	const latestLate = now.getTime() - latest.getTime() > graceMs;
	const missedAll = latestLate ? due : missed;
	return {
		representative: latest,
		kind: latestLate ? 'catch_up' : 'normal',
		missedFrom: missedAll[0] ?? null,
		missedTo: missedAll[missedAll.length - 1] ?? null,
		missedCount: missedAll.length
	};
}
