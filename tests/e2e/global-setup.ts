import { seed } from './seed.ts';

export default async function globalSetup() {
	await seed();
}
