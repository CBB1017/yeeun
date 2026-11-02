<script lang="ts">
	import type { PageProps } from './$types';
	import DraftEditor from '#lib/components/draft/DraftEditor.svelte';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>업무 계획 확인 · Yeeun</title>
</svelte:head>

{#key data.draft.id}
	<DraftEditor draft={data.draft} grants={data.grants} />
{/key}
