<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Dialog } from 'bits-ui';
	import { X } from '@lucide/svelte';

	/**
	 * Accessible dialog (bits-ui): focus is trapped while open and returned to the
	 * previously focused element on close; Escape closes.
	 *  - center: centred modal
	 *  - sheet:  bottom sheet on phones, right side panel from md
	 *  - drawer: left navigation drawer
	 *  - full:   full-screen on phones, centred on larger screens
	 */
	type Props = {
		open: boolean;
		title: string;
		description?: string;
		variant?: 'center' | 'sheet' | 'drawer' | 'full';
		size?: 'md' | 'lg';
		children: Snippet;
		footer?: Snippet;
		onclose?: () => void;
		testid?: string;
	};
	let { open = $bindable(false), title, description, variant = 'center', size = 'md', children, footer, onclose, testid }: Props = $props();

	const panel = $derived(
		{
			center: `left-1/2 top-1/2 w-[calc(100%-2rem)] ${size === 'lg' ? 'max-w-3xl' : 'max-w-lg'} -translate-x-1/2 -translate-y-1/2 max-h-[calc(100dvh-2rem)] rounded-[8px]`,
			sheet: 'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-[12px] md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:h-dvh md:w-[28rem] md:rounded-none md:rounded-l-[8px]',
			drawer: 'inset-y-0 left-0 h-dvh w-[min(20rem,85vw)] rounded-r-[8px]',
			full: `inset-0 h-dvh w-full md:inset-auto md:left-1/2 md:top-1/2 md:h-auto md:max-h-[calc(100dvh-4rem)] md:w-[calc(100%-4rem)] ${size === 'lg' ? 'md:max-w-4xl' : 'md:max-w-2xl'} md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[8px]`
		}[variant]
	);
</script>

<Dialog.Root
	bind:open
	onOpenChange={(o) => {
		if (!o) onclose?.();
	}}
>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-40 bg-[#0f172a]/50" />
		<Dialog.Content class="fixed z-50 flex flex-col overflow-hidden border border-line bg-surface shadow-xl {panel}" data-testid={testid}>
			<div class="flex items-start justify-between gap-3 border-b border-line-soft px-4 py-3 md:px-5">
				<div class="min-w-0">
					<Dialog.Title level={2} class="text-lg leading-snug font-bold">{title}</Dialog.Title>
					{#if description}
						<Dialog.Description class="hint mt-0.5">{description}</Dialog.Description>
					{/if}
				</div>
				<Dialog.Close class="-mr-2 inline-flex size-11 flex-none items-center justify-center rounded-[8px] text-muted hover:bg-subtle hover:text-ink" aria-label="닫기">
					<X size={20} />
				</Dialog.Close>
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5">
				{@render children()}
			</div>
			{#if footer}
				<div class="flex flex-wrap justify-end gap-2 border-t border-line-soft px-4 py-3 md:px-5">
					{@render footer()}
				</div>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
