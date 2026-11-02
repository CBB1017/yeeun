export const ERROR_CODES = [
	'AUTH_REQUIRED',
	'INVITATION_REQUIRED',
	'FORBIDDEN',
	'NOT_FOUND',
	'CSRF_FAILED',
	'VALIDATION_FAILED',
	'CONFLICT',
	'DRIVE_REAUTH_REQUIRED',
	'SOURCE_MISSING',
	'SOURCE_CHANGED_DURING_CAPTURE',
	'SOURCE_TOO_LARGE',
	'UNSUPPORTED_FORMAT',
	'PARSE_FAILED',
	'CLI_UNAVAILABLE',
	'CLI_AUTH_FAILED',
	'USAGE_LIMIT',
	'NETWORK_FAILED',
	'UPSTREAM_5XX',
	'EXECUTION_FAILED',
	'OUTPUT_SCHEMA_INVALID',
	'TIMEOUT',
	'CANCELLED',
	'INTERRUPTED',
	'STORAGE_FAILED',
	'DELIVERY_FAILED',
	'INPUT_REQUIRED',
	'CAPABILITY_UNAVAILABLE',
	'NOT_CONFIGURED'
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

const HTTP_STATUS: Partial<Record<ErrorCode, number>> = {
	AUTH_REQUIRED: 401,
	INVITATION_REQUIRED: 403,
	FORBIDDEN: 403,
	CSRF_FAILED: 403,
	NOT_FOUND: 404,
	VALIDATION_FAILED: 400,
	INPUT_REQUIRED: 400,
	UNSUPPORTED_FORMAT: 400,
	SOURCE_TOO_LARGE: 413,
	CONFLICT: 409,
	DRIVE_REAUTH_REQUIRED: 409,
	CAPABILITY_UNAVAILABLE: 503,
	NOT_CONFIGURED: 503
};

export class AppError extends Error {
	constructor(
		public code: ErrorCode,
		message: string,
		public stage: string | null = null,
		public details?: unknown
	) {
		super(message);
		this.name = 'AppError';
	}
	get status(): number {
		return HTTP_STATUS[this.code] ?? 500;
	}
}

export function isAppError(e: unknown): e is AppError {
	return e instanceof AppError;
}

/** Remove things that must never reach logs or user-visible error text. */
export function redact(text: string): string {
	return text
		.replace(/(sk-[A-Za-z0-9_-]{10,})/g, '[redacted-key]')
		.replace(/(ya29\.[A-Za-z0-9._-]+)/g, '[redacted-token]')
		.replace(/(1\/\/[A-Za-z0-9._-]{20,})/g, '[redacted-token]')
		.replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[redacted]')
		.replace(/("?(?:access|refresh|id)_token"?\s*[:=]\s*"?)[^"\s,}]+/gi, '$1[redacted]')
		.replace(/(password\s*[:=]\s*)\S+/gi, '$1[redacted]')
		.replace(/\/(?:data|cli-auth)\/[^\s"']+/g, '[path]')
		.slice(0, 2000);
}
