/** Global polite live region: status updates are announced without moving focus. */
export const live = $state({ message: '' });

let timer: ReturnType<typeof setTimeout> | undefined;

export function announce(message: string) {
	live.message = '';
	if (timer) clearTimeout(timer);
	// Clearing first lets screen readers re-announce identical text.
	timer = setTimeout(() => {
		live.message = message;
	}, 60);
}
