import type { RequestHandler } from '@sveltejs/kit';
import { handler, requireUser } from '#lib/server/http.ts';
import { getOwnedRun } from '#lib/server/runs/service.ts';
import { eventsSince } from '#lib/server/runs/events.ts';
import { subscribeRunEvents } from '#lib/server/sse.ts';

/**
 * SSE with cursor replay (Last-Event-ID / ?after=). Disconnects never cancel or
 * recreate the run; the client simply reconnects and replays from its cursor.
 */
export const GET: RequestHandler = handler(async (event) => {
	const u = requireUser(event);
	const run = await getOwnedRun(u.id, event.params.id!);
	let cursor = Number(event.request.headers.get('last-event-id') ?? event.url.searchParams.get('after') ?? 0) || 0;
	const enc = new TextEncoder();
	let unsubscribe: () => void = () => {};
	let ping: ReturnType<typeof setInterval> | undefined;
	const stream = new ReadableStream({
		async start(controller) {
			let busy = false;
			const flush = async () => {
				if (busy) return;
				busy = true;
				try {
					const rows = await eventsSince(run.id, u.id, cursor);
					for (const r of rows) {
						cursor = r.seq;
						controller.enqueue(
							enc.encode(
								`id: ${r.seq}\nevent: run\ndata: ${JSON.stringify({ seq: r.seq, type: r.type, data: r.data, at: r.created_at })}\n\n`
							)
						);
					}
				} catch {
					/* transient DB error: next notification retries */
				} finally {
					busy = false;
				}
			};
			controller.enqueue(enc.encode('retry: 3000\n\n'));
			await flush();
			unsubscribe = await subscribeRunEvents(run.id, () => void flush());
			ping = setInterval(() => {
				try {
					controller.enqueue(enc.encode(': ping\n\n'));
				} catch {
					/* closed */
				}
			}, 20_000);
		},
		cancel() {
			unsubscribe();
			if (ping) clearInterval(ping);
		}
	});
	event.request.signal.addEventListener('abort', () => {
		unsubscribe();
		if (ping) clearInterval(ping);
	});
	return new Response(stream, {
		headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' }
	});
});
