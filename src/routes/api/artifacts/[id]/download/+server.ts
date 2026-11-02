import { Readable } from 'node:stream';
import { handler, requireUser } from '#lib/server/http.ts';
import { ownedArtifact } from '#lib/server/runs/views.ts';
import { openRetainedStream } from '#lib/server/storage.ts';

/** Owner-checked stream; the host path is never exposed. */
export const GET = handler(async (event) => {
	const u = requireUser(event);
	const a = await ownedArtifact(u.id, event.params.id!);
	const { stream, size } = await openRetainedStream(a.storageRootId, a.relativePath);
	return new Response(Readable.toWeb(stream) as ReadableStream, {
		headers: {
			'content-type': a.mimeType,
			'content-length': String(size),
			'content-disposition': `attachment; filename="${a.filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
			'cache-control': 'private, no-store',
			'x-content-sha256': a.sha256
		}
	});
});
