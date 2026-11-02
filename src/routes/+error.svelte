<script lang="ts">
	import { page } from '$app/state';
	const notFound = $derived(page.status === 404);
</script>

<svelte:head>
	<title>{notFound ? '찾을 수 없음' : '오류'} · Yeeun</title>
</svelte:head>

<div class="mx-auto max-w-xl px-4 py-12" data-testid="error-page">
	<p class="text-sm font-semibold text-muted">HTTP {page.status}</p>
	<h1 class="mt-1 text-2xl font-bold">{notFound ? '찾을 수 없습니다' : '페이지를 표시하지 못했습니다'}</h1>
	<p class="mt-2 text-muted">
		{#if notFound}
			주소가 잘못되었거나 볼 수 있는 권한이 없는 항목입니다.
		{:else}
			{page.error?.message ?? '알 수 없는 오류'}
		{/if}
	</p>
	<a href="/" class="mt-6 inline-flex min-h-11 items-center font-semibold">홈으로 가기</a>
</div>
