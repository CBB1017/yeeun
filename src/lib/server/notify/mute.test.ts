import { describe, expect, it } from 'vitest';
import { isMutedAt, muteExpiry, shouldSuppress } from './mute';

describe('daily mute boundary at Asia/Seoul midnight (A21)', () => {
	// 2026-11-02 10:00 KST = 2026-11-02T01:00:00Z
	const mutedAt = new Date('2026-11-02T01:00:00Z');
	const until = muteExpiry(mutedAt);

	it('expires at the next 00:00 KST', () => {
		expect(until.toISOString()).toBe('2026-11-02T15:00:00.000Z'); // 2026-11-03 00:00 KST
	});
	it('23:59:59 KST the same day is still muted', () => {
		expect(isMutedAt(until, new Date('2026-11-02T14:59:59Z'))).toBe(true);
		expect(shouldSuppress('normal', until, new Date('2026-11-02T14:59:59.999Z'))).toBe(true);
	});
	it('00:00 KST the next day is not muted', () => {
		expect(isMutedAt(until, new Date('2026-11-02T15:00:00Z'))).toBe(false);
		expect(shouldSuppress('normal', until, new Date('2026-11-02T15:00:00Z'))).toBe(false);
	});
	it('errors are never suppressed', () => {
		expect(shouldSuppress('error', until, new Date('2026-11-02T02:00:00Z'))).toBe(false);
	});
	it('muting just after midnight KST lasts until the following midnight', () => {
		expect(muteExpiry(new Date('2026-11-02T15:00:00Z')).toISOString()).toBe('2026-11-03T15:00:00.000Z');
	});
	it('muting late UTC day (already next KST day) uses the KST calendar', () => {
		// 2026-11-02T20:00Z = 2026-11-03 05:00 KST -> 2026-11-04 00:00 KST
		expect(muteExpiry(new Date('2026-11-02T20:00:00Z')).toISOString()).toBe('2026-11-03T15:00:00.000Z');
	});
	it('no mute rule means not muted', () => {
		expect(isMutedAt(null, mutedAt)).toBe(false);
	});
});
