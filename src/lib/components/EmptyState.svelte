<script lang="ts">
	import type { Snippet } from 'svelte';
	type Props = { title: string; children?: Snippet; actions?: Snippet; testid?: string };
	let { title, children, actions, testid }: Props = $props();
</script>

<div class="rounded-[8px] border border-dashed border-[#94a3b8] bg-surface px-4 py-6 text-center" data-testid={testid}>
	<p class="font-semibold">{title}</p>
	{#if children}<div class="hint mx-auto mt-1 max-w-prose">{@render children()}</div>{/if}
	{#if actions}<div class="mt-4 flex flex-wrap justify-center gap-2">{@render actions()}</div>{/if}
</div>
