<script lang="ts">
	import './layout.css';
	import type { LayoutProps } from './$types';
	import { live } from '#lib/client/live.svelte.ts';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href="/icon.svg" type="image/svg+xml" />
</svelte:head>

{@render children()}

<div class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="live-region">{live.message}</div>
