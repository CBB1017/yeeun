import { handler, ok, requireMutation, requireUser } from '#lib/server/http.ts';
import { connectionStatus, disconnect } from '#lib/server/drive/service.ts';

export const GET = handler(async (event) => ok(event, await connectionStatus(requireUser(event).id)));
export const DELETE = handler(async (event) => ok(event, await disconnect(requireMutation(event).id)));
