import type { RunEvent } from './types.ts';

/**
 * Run events over SSE. EventSource resends Last-Event-ID on its own reconnects;
 * if the stream is closed (e.g. a server restart returned a non-stream response)
 * we reopen it with ?after=<cursor>. Disconnecting never cancels the run.
 */
export function subscribeRunEvents(
	runId: string,
	initialCursor: number,
	onEvent: (e: RunEvent) => void,
	onConnection?: (state: 'open' | 'reconnecting') => void
): () => void {
	let cursor = initialCursor;
	let es: EventSource | null = null;
	let closed = false;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let attempts = 0;

	const open = () => {
		if (closed) return;
		es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events?after=${cursor}`);
		es.addEventListener('open', () => {
			attempts = 0;
			onConnection?.('open');
		});
		es.addEventListener('run', (msg) => {
			try {
				const e = JSON.parse((msg as MessageEvent<string>).data) as RunEvent;
				if (e.seq <= cursor) return;
				cursor = e.seq;
				onEvent(e);
			} catch {
				/* ignore malformed frame */
			}
		});
		es.addEventListener('error', () => {
			onConnection?.('reconnecting');
			if (es && es.readyState === EventSource.CLOSED) {
				es = null;
				attempts++;
				retry = setTimeout(open, Math.min(30_000, 2000 * attempts));
			}
		});
	};
	open();
	return () => {
		closed = true;
		if (retry) clearTimeout(retry);
		es?.close();
	};
}
