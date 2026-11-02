import { handler, requireUser } from '#lib/server/http.ts';
import { ownedArtifact } from '#lib/server/runs/views.ts';
import { readRetained } from '#lib/server/storage.ts';
import { AppError } from '#lib/server/errors.ts';

export const GET = handler(async (event) => {
	const u = requireUser(event);
	const a = await ownedArtifact(u.id, event.params.id!);
	const p = (a.validation as { preview_path?: string | null }).preview_path;
	if (!p) throw new AppError('NOT_FOUND', '미리보기 없음');
	const buf = await readRetained(a.storageRootId, p);
	return new Response(new Uint8Array(buf), { headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store' } });
});
