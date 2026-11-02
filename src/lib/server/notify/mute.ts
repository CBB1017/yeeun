import { nextSeoulMidnight } from '../schedule/rules';

/**
 * Daily task mute ("오늘은 알림 더 표시 안함"): normal notifications for one
 * task are suppressed until the next Asia/Seoul midnight. Errors bypass it.
 */
export function muteExpiry(now: Date): Date {
	return nextSeoulMidnight(now);
}

/** A mute is active while `at` is strictly before `muteUntil` (00:00 KST itself is unmuted). */
export function isMutedAt(muteUntil: Date | null | undefined, at: Date): boolean {
	return !!muteUntil && muteUntil.getTime() > at.getTime();
}

/** Errors are never suppressed; only normal notifications for a muted task are. */
export function shouldSuppress(severity: 'normal' | 'error', muteUntil: Date | null | undefined, at: Date): boolean {
	return severity === 'normal' && isMutedAt(muteUntil, at);
}
