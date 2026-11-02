<script lang="ts">
	import type { PageProps } from './$types';
	import SettingsView from '#lib/components/settings/SettingsView.svelte';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>알림·설정 · Yeeun</title>
</svelte:head>

<SettingsView me={data.me} initial={data.settings} senders={data.senders} recent={data.recent} />
