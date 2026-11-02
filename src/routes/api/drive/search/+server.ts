import { handler, ok, requireUser } from '#lib/server/http.ts';
import { searchDrive } from '#lib/server/drive/service.ts';

/** Natural-language search of the caller's own Drive; returns candidates only (nothing is granted). */
export const GET = handler(async (event) => ok(event, await searchDrive(requireUser(event).id, (event.url.searchParams.get('q') ?? '').slice(0, 2000))));
