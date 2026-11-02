<script lang="ts">
	import type { PageProps } from './$types';
	import AdminView from '#lib/components/admin/AdminView.svelte';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>관리 · Yeeun</title>
</svelte:head>

{#if data.allowed}
	<AdminView invitations={data.invitations} capabilities={data.capabilities} roots={data.roots} selfEmail={data.me.user.email} />
{:else}
	<div class="max-w-xl py-6" data-testid="error-page">
		<h1 class="text-2xl font-bold">찾을 수 없습니다</h1>
		<p class="mt-2 text-muted">관리자만 볼 수 있는 화면입니다.</p>
		<a href="/" class="mt-6 inline-flex min-h-11 items-center font-semibold">홈으로 가기</a>
	</div>
{/if}
