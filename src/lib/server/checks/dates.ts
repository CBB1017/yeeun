/**
 * Strict calendar-date handling. Values that do not match a recognised format
 * or are not real calendar dates are reported, never silently corrected.
 */

const PATTERNS: RegExp[] = [
	/^(\d{4})-(\d{1,2})-(\d{1,2})$/,
	/^(\d{4})\.\s?(\d{1,2})\.\s?(\d{1,2})\.?$/,
	/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/,
	/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/
];

export function isValidYmd(y: number, m: number, d: number): boolean {
	if (m < 1 || m > 12 || d < 1) return false;
	const dt = new Date(Date.UTC(y, m - 1, d));
	return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function pad(n: number, w = 2): string {
	return String(n).padStart(w, '0');
}

/** Returns YYYY-MM-DD or null when the text is not an unambiguous valid date. */
export function parseStrictDate(text: string): string | null {
	const t = text.trim();
	for (const re of PATTERNS) {
		const m = re.exec(t);
		if (!m) continue;
		const y = Number(m[1]);
		const mo = Number(m[2]);
		const d = Number(m[3]);
		return isValidYmd(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
	}
	return null;
}

export function addDays(ymd: string, days: number): string {
	const [y, m, d] = ymd.split('-').map(Number);
	const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
	return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Inclusive window: start .. start + (days - 1). */
export function dateWindow(start: string, days: number): { from: string; to: string } {
	return { from: start, to: addDays(start, days - 1) };
}

export function inRange(ymd: string, from: string, to: string): boolean {
	return ymd >= from && ymd <= to;
}
