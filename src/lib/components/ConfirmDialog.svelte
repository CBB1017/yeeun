<script lang="ts">
	import type { Snippet } from 'svelte';
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import Notice from './Notice.svelte';
	import { messageOf } from '#lib/client/api.ts';

	type Props = {
		open: boolean;
		title: string;
		confirmLabel: string;
		cancelLabel?: string;
		tone?: 'primary' | 'danger';
		onconfirm: () => Promise<void> | void;
		children?: Snippet;
		testid?: string;
	};
	let { open = $bindable(false), title, confirmLabel, cancelLabel = '취소', tone = 'primary', onconfirm, children, testid }: Props = $props();
	let busy = $state(false);
	let err = $state('');

	async function confirm() {
		busy = true;
		err = '';
		try {
			await onconfirm();
			open = false;
		} catch (e) {
			err = messageOf(e);
		} finally {
			busy = false;
		}
	}
</script>

<Modal bind:open {title} onclose={() => (err = '')} {testid}>
	{#if children}<div class="space-y-2">{@render children()}</div>{/if}
	{#if err}
		<Notice tone="danger" role="alert" class="mt-3">{err}</Notice>
	{/if}
	{#snippet footer()}
		<Button onclick={() => (open = false)} disabled={busy}>{cancelLabel}</Button>
		<Button variant={tone === 'danger' ? 'danger' : 'primary'} onclick={confirm} disabled={busy} aria-busy={busy}>
			{busy ? '처리 중…' : confirmLabel}
		</Button>
	{/snippet}
</Modal>
