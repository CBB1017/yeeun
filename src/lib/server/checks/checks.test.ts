import { describe, expect, it } from 'vitest';
import { addDays, dateWindow, parseStrictDate } from './dates';
import { add, canonicalNumber, div, fromInt, parseDec, roundHalfUp, toCanonical } from './decimal';

describe('dates (A07)', () => {
	it('30-date inclusive window from Nov 1 ends Nov 30', () => {
		expect(dateWindow('2026-11-01', 30)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
	});
	it('30-date inclusive window from Nov 2 ends Dec 1', () => {
		expect(dateWindow('2026-11-02', 30)).toEqual({ from: '2026-11-02', to: '2026-12-01' });
	});
	it('never silently corrects invalid dates', () => {
		expect(parseStrictDate('2026-02-30')).toBeNull();
		expect(parseStrictDate('2026.13.01')).toBeNull();
		expect(parseStrictDate('11/30')).toBeNull();
		expect(parseStrictDate('2026. 11. 30.')).toBe('2026-11-30');
		expect(parseStrictDate('2026년 12월 1일')).toBe('2026-12-01');
	});
	it('adds days across month and leap boundaries', () => {
		expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
	});
});

describe('decimal (exact, no tolerance)', () => {
	it('adds without float error', () => {
		expect(toCanonical(add(parseDec('0.1')!, parseDec('0.2')!))).toBe('0.3');
	});
	it('divides with explicit half-up rounding', () => {
		expect(toCanonical(div(fromInt(2), fromInt(3), 2))).toBe('0.67');
		expect(toCanonical(div(fromInt(-2), fromInt(3), 2))).toBe('-0.67');
		expect(toCanonical(roundHalfUp(parseDec('1.005')!, 2))).toBe('1.01');
	});
	it('canonicalises representation only', () => {
		expect(canonicalNumber('1,200.50')).toBe('1200.5');
		expect(canonicalNumber('abc')).toBeNull();
		expect(canonicalNumber('-0.0')).toBe('0');
	});
});
