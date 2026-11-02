import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { secret } from './config';

/**
 * AES-256-GCM envelope for secrets stored in the database (OAuth refresh tokens,
 * SMTP passwords, push subscriptions). Format: v1.<iv>.<tag>.<ciphertext> (base64url).
 */

let masterKey: Buffer | undefined;

export function loadMasterKey(): Buffer {
	if (masterKey) return masterKey;
	const raw = secret('APP_MASTER_KEY');
	if (!raw) throw new Error('APP_MASTER_KEY_FILE is required (32-byte key, hex or base64)');
	const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
	if (key.length !== 32) throw new Error('APP_MASTER_KEY must decode to exactly 32 bytes');
	masterKey = key;
	return key;
}

export function setMasterKeyForTests(key: Buffer | undefined): void {
	masterKey = key;
}

export function encrypt(plaintext: string, aad = ''): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', loadMasterKey(), iv);
	if (aad) cipher.setAAD(Buffer.from(aad));
	const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(envelope: string, aad = ''): string {
	const [v, iv, tag, ct] = envelope.split('.');
	if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Unsupported ciphertext');
	const decipher = createDecipheriv('aes-256-gcm', loadMasterKey(), Buffer.from(iv, 'base64url'));
	if (aad) decipher.setAAD(Buffer.from(aad));
	decipher.setAuthTag(Buffer.from(tag, 'base64url'));
	return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

export function sha256Hex(data: string | Buffer): string {
	return createHash('sha256').update(data).digest('hex');
}

export function randomToken(bytes = 32): string {
	return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Canonical JSON (sorted keys) for stable hashing of plans/manifests/inputs. */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value && typeof value === 'object' && !(value instanceof Date)) {
		const out: Record<string, unknown> = {};
		for (const k of Object.keys(value as object).sort()) {
			const v = (value as Record<string, unknown>)[k];
			if (v !== undefined) out[k] = sortKeys(v);
		}
		return out;
	}
	return value;
}

export function hashJson(value: unknown): string {
	return sha256Hex(canonicalJson(value));
}
