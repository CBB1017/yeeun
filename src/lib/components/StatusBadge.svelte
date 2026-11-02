<script lang="ts">
	import { CircleCheck, CircleX, TriangleAlert, Clock, LoaderCircle, Ban } from '@lucide/svelte';
	import { stateInfo, type Tone } from '#lib/client/format.ts';

	type Props = { state?: string; tone?: Tone; label?: string; class?: string };
	let { state, tone, label, class: cls = '' }: Props = $props();

	const info = $derived(state ? stateInfo(state) : null);
	const t = $derived<Tone>(tone ?? info?.tone ?? 'neutral');
	const text = $derived(label ?? info?.label ?? '');
	const styles: Record<Tone, string> = {
		neutral: 'bg-subtle text-ink border-line',
		progress: 'bg-primary-soft text-primary border-[#99f6e4]',
		success: 'bg-primary-soft text-primary border-[#5eead4]',
		warning: 'bg-warning-soft text-warning border-[#fcd34d]',
		danger: 'bg-danger-soft text-danger border-[#fca5a5]'
	};
</script>

<span class="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-semibold whitespace-nowrap {styles[t]} {cls}" data-state={state}>
	{#if t === 'success'}
		<CircleCheck size={16} />
	{:else if t === 'danger'}
		<CircleX size={16} />
	{:else if t === 'warning'}
		<TriangleAlert size={16} />
	{:else if t === 'progress'}
		<LoaderCircle size={16} />
	{:else if state === 'cancelled'}
		<Ban size={16} />
	{:else}
		<Clock size={16} />
	{/if}
	<span>{text}</span>
</span>
