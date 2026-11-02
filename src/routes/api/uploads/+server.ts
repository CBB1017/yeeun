import { handler, ok, readBodyLimited, requireMutation, requireUser } from '#lib/server/http.ts';
import { AppError } from '#lib/server/errors.ts';
import { listUploads, storeUpload, uploadLimits } from '#lib/server/uploads/service.ts';

/**
 * GET: limits + the user's retained uploads.
 * POST: one file per request as the raw body (application/octet-stream);
 * the original name is sent URI-encoded in `x-file-name`.
 */
export const GET = handler(async (event) => {
	const u = requireUser(event);
	return ok(event, { limits: uploadLimits(), items: await listUploads(u.id) });
});

export const POST = handler(async (event) => {
	const u = requireMutation(event);
	const rawName = event.request.headers.get('x-file-name');
	if (!rawName) throw new AppError('VALIDATION_FAILED', '파일 이름이 없습니다');
	let name: string;
	try {
		name = decodeURIComponent(rawName);
	} catch {
		throw new AppError('VALIDATION_FAILED', '파일 이름 형식 오류');
	}
	const limit = uploadLimits().maxFileBytes;
	const bytes = await readBodyLimited(event.request, limit, () => new AppError('SOURCE_TOO_LARGE', '파일 크기 한도를 넘습니다'));
	return ok(event, await storeUpload(u.id, name, bytes), 201);
});
