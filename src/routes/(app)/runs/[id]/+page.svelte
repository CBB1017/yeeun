<script lang="ts">
	import type { PageProps } from './$types';
	import RunView from '#lib/components/run/RunView.svelte';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.detail.task?.title ?? '실행'} · 실행 결과 · Yeeun</title>
</svelte:head>

{#key data.detail.run.id}
	<RunView detail={data.detail} result={data.result} evidence={data.evidence} />
{/key}
