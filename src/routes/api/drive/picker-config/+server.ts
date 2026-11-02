import { handler, ok, requireUser } from '#lib/server/http.ts';
import { pickerConfig } from '#lib/server/drive/service.ts';

export const GET = handler(async (event) => ok(event, await pickerConfig(requireUser(event).id)));
