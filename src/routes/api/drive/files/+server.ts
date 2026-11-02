import { handler, ok, requireUser } from '#lib/server/http.ts';
import { searchGrants } from '#lib/server/drive/service.ts';

/** Searches only this user's allowed-file list; never queries Drive. */
export const GET = handler(async (event) =>
	ok(event, {
		scope: 'allowed_files_only',
		files: await searchGrants(requireUser(event).id, (event.url.searchParams.get('q') ?? '').slice(0, 200))
	})
);
