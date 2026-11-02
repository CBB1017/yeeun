<script lang="ts">
	import type { Snippet } from 'svelte';
	type Props = { title: string; description?: string; meta?: Snippet; actions?: Snippet; back?: { href: string; label: string } };
	let { title, description, meta, actions, back }: Props = $props();
</script>

<header class="mb-5 flex min-w-0 flex-col gap-3 md:mb-6 md:flex-row md:items-start md:justify-between">
	<div class="min-w-0">
		{#if back}
			<a href={back.href} class="mb-1 inline-flex min-h-11 items-center text-sm font-semibold">← {back.label}</a>
		{/if}
		<h1 class="text-2xl leading-tight font-bold break-words md:text-[1.75rem]">{title}</h1>
		{#if description}<p class="mt-1 text-muted">{description}</p>{/if}
		{#if meta}<div class="mt-2 flex flex-wrap items-center gap-2">{@render meta()}</div>{/if}
	</div>
	{#if actions}
		<div class="flex flex-wrap gap-2 md:flex-none md:justify-end">{@render actions()}</div>
	{/if}
</header>
