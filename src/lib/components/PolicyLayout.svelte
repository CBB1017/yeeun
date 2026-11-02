<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = { title: string; effective: string; children: Snippet };
	let { title, effective, children }: Props = $props();
</script>

<svelte:head>
	<title>{title} · Yeeun</title>
	<meta name="robots" content="index,follow" />
</svelte:head>

<main id="main" class="mx-auto w-full max-w-3xl px-4 py-10">
	<a href="/login" class="text-sm">← Yeeun</a>
	<h1 class="mt-4 text-2xl font-bold">{title}</h1>
	<p class="mt-1 text-sm text-muted">시행일: {effective}</p>
	<div class="policy mt-6 space-y-6 leading-relaxed">
		{@render children()}
	</div>
	<nav class="mt-10 flex gap-4 border-t border-border pt-4 text-sm" aria-label="정책">
		<a href="/privacy">개인정보처리방침</a>
		<a href="/terms">서비스 약관</a>
	</nav>
</main>

<style>
	.policy :global(h2) {
		font-size: 1.125rem;
		font-weight: 700;
		margin-bottom: 0.5rem;
	}
	.policy :global(ul) {
		list-style: disc;
		padding-left: 1.25rem;
	}
	.policy :global(li + li) {
		margin-top: 0.25rem;
	}
</style>
