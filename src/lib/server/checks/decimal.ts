/** Exact decimal arithmetic on strings (no binary floating point, no tolerance). */

export interface Dec {
	n: bigint; // unscaled integer
	s: number; // scale (digits after the point)
}

const DEC_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

export function parseDec(text: string): Dec | null {
	const t = text.trim().replace(/,/g, '');
	const m = DEC_RE.exec(t);
	if (!m) return null;
	const frac = m[3] ?? '';
	const n = BigInt((m[2] ?? '0') + frac);
	return { n: m[1] ? -n : n, s: frac.length };
}

function scaleTo(d: Dec, s: number): bigint {
	return d.n * 10n ** BigInt(s - d.s);
}

export function add(a: Dec, b: Dec): Dec {
	const s = Math.max(a.s, b.s);
	return { n: scaleTo(a, s) + scaleTo(b, s), s };
}

export function cmp(a: Dec, b: Dec): number {
	const s = Math.max(a.s, b.s);
	const x = scaleTo(a, s);
	const y = scaleTo(b, s);
	return x < y ? -1 : x > y ? 1 : 0;
}

/** Divide with half-up rounding to `digits` places. */
export function div(a: Dec, b: Dec, digits: number): Dec {
	if (b.n === 0n) throw new Error('division by zero');
	// a/b = (a.n / 10^a.s) / (b.n / 10^b.s)
	const scale = 10n ** BigInt(digits + 1);
	let num = a.n * 10n ** BigInt(b.s) * scale;
	let den = b.n * 10n ** BigInt(a.s);
	if (den < 0n) {
		den = -den;
		num = -num;
	}
	const q = num / den; // one extra digit, truncated toward zero
	return roundHalfUp({ n: q, s: digits + 1 }, digits);
}

export function roundHalfUp(d: Dec, digits: number): Dec {
	if (d.s <= digits) return { n: scaleTo(d, digits), s: digits };
	const drop = 10n ** BigInt(d.s - digits);
	const neg = d.n < 0n;
	const abs = neg ? -d.n : d.n;
	let q = abs / drop;
	const r = abs % drop;
	if (r * 2n >= drop) q += 1n;
	return { n: neg ? -q : q, s: digits };
}

export function toCanonical(d: Dec): string {
	let n = d.n;
	let s = d.s;
	while (s > 0 && n % 10n === 0n) {
		n /= 10n;
		s -= 1;
	}
	const neg = n < 0n;
	const abs = (neg ? -n : n).toString().padStart(s + 1, '0');
	const out = s === 0 ? abs : `${abs.slice(0, abs.length - s)}.${abs.slice(abs.length - s)}`;
	return neg && out !== '0' ? `-${out}` : out;
}

export function canonicalNumber(text: string): string | null {
	const d = parseDec(text);
	return d ? toCanonical(d) : null;
}

export function fromInt(n: number): Dec {
	return { n: BigInt(n), s: 0 };
}
