import { cleanup } from './seed.ts';

/** Remove all @example.test data unless E2E_KEEP_SEED=1 (for manual inspection). */
export default async function globalTeardown() {
	if (process.env.E2E_KEEP_SEED === '1') return;
	await cleanup();
}
