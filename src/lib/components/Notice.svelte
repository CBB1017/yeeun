<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Info, CircleCheck, TriangleAlert, CircleAlert } from '@lucide/svelte';

	type Props = {
		tone?: 'info' | 'success' | 'warning' | 'danger';
		title?: string;
		role?: 'status' | 'alert' | 'note';
		class?: string;
		children?: Snippet;
		actions?: Snippet;
		testid?: string;
	};
	let { tone = 'info', title, role, class: cls = '', children, actions, testid }: Props = $props();
	const styles = {
		info: 'border-line bg-surface text-ink',
		success: 'border-[#5eead4] bg-primary-soft text-ink',
		warning: 'border-[#fcd34d] bg-warning-soft text-ink',
		danger: 'border-[#fca5a5] bg-danger-soft text-ink'
	};
	const iconColor = { info: 'text-muted', success: 'text-primary', warning: 'text-warning', danger: 'text-danger' };
	const prefix = { info: '안내', success: '완료', warning: '주의', danger: '오류' };
</script>

<div class="flex min-w-0 gap-3 rounded-[8px] border p-3 md:p-4 {styles[tone]} {cls}" {role} data-testid={testid}>
	<span class="mt-0.5 flex-none {iconColor[tone]}">
		{#if tone === 'success'}
			<CircleCheck size={20} />
		{:else if tone === 'warning'}
			<TriangleAlert size={20} />
		{:else if tone === 'danger'}
			<CircleAlert size={20} />
		{:else}
			<Info size={20} />
		{/if}
	</span>
	<div class="min-w-0 flex-1">
		{#if title}
			<p class="font-semibold"><span class="sr-only">{prefix[tone]}: </span>{title}</p>
		{:else}
			<span class="sr-only">{prefix[tone]}: </span>
		{/if}
		{#if children}
			<div class="text-[0.9375rem] [&_p+p]:mt-1 {title ? 'mt-1' : ''}">{@render children()}</div>
		{/if}
		{#if actions}
			<div class="mt-3 flex flex-wrap gap-2">{@render actions()}</div>
		{/if}
	</div>
</div>
