import type { SessionUser } from '#lib/server/auth/users.ts';

declare global {
	namespace App {
		interface Locals {
			requestId: string;
			user: SessionUser | null;
		}
		interface Error {
			code?: string;
		}
	}
}

export {};
