<script lang="ts">
	import { untrack } from 'svelte';
	import { Search, FileSpreadsheet, ExternalLink } from '@lucide/svelte';
	import Button from './Button.svelte';
	import Notice from './Notice.svelte';
	import { api, messageOf } from '#lib/client/api.ts';
	import { announce } from '#lib/client/live.svelte.ts';
	import { fmtDateTime, mimeLabel } from '#lib/client/format.ts';
	import type { Grant } from '#lib/client/types.ts';

	type Candidate = {
		fileId: string;
		name: string;
		mimeType: string;
		modifiedAt: string | null;
		folder: string | null;
		webViewLink: string | null;
		alreadyAllowed: boolean;
	};
	type Result = { available: boolean; reason: string | null; keywords: string[]; candidates: Candidate[] };

	type Props = {
		/** Natural-language text to search with (e.g. the original request). */
		initialQuery?: string;
		/** Run the search immediately with initialQuery. */
		auto?: boolean;
		disabled?: boolean;
		onPick: (g: Grant) => void;
		idPrefix?: string;
	};
	let { initialQuery = '', auto = false, disabled = false, onPick, idPrefix = 'drive-search' }: Props = $props();

	let query = $state(untrack(() => initialQuery));
	let loading = $state(false);
	let adding = $state<string | null>(null);
	let result = $state<Result | null>(null);
	let error = $state<string | null>(null);

	async function search() {
		if (!query.trim()) return;
		loading = true;
		error = null;
		try {
			result = await api<Result>(`/api/drive/search?q=${encodeURIComponent(query.trim())}`);
			announce(result.available ? `Drive에서 후보 ${result.candidates.length}개를 찾았습니다` : (result.reason ?? 'Drive 검색을 할 수 없습니다'));
		} catch (e) {
			error = messageOf(e);
		} finally {
			loading = false;
		}
	}

	async function use(c: Candidate) {
		adding = c.fileId;
		error = null;
		try {
			const r = await api<{ added: Grant[]; rejected: { id: string; reason: string; message?: string | null }[] }>('/api/drive/grants', {
				method: 'POST',
				body: { fileIds: [c.fileId] }
			});
			const g = r.added[0];
			if (!g) throw new Error(r.rejected[0]?.message ?? '파일을 허용 목록에 추가하지 못했습니다');
			c.alreadyAllowed = true;
			announce(`${g.name}을(를) 허용 목록에 추가하고 선택했습니다`);
			onPick(g);
		} catch (e) {
			error = messageOf(e);
		} finally {
			adding = null;
		}
	}

	$effect(() => {
		if (auto && untrack(() => query.trim()) && !untrack(() => result)) untrack(() => void search());
	});
</script>

<div class="mt-3 rounded-[8px] border border-border bg-surface p-3" data-testid="drive-search">
	<form
		class="flex flex-wrap items-end gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			void search();
		}}
	>
		<div class="min-w-0 flex-1">
			<label for="{idPrefix}-q" class="label">Drive에서 찾기</label>
			<input id="{idPrefix}-q" class="input" bind:value={query} placeholder="예: 연구과제 목록 엑셀" maxlength={2000} {disabled} />
		</div>
		<Button type="submit" size="sm" disabled={disabled || loading || !query.trim()}><Search size={16} />{loading ? '찾는 중…' : '찾기'}</Button>
	</form>
	<p class="hint mt-1">내 Drive에서 파일 이름으로 후보를 찾습니다. 고른 파일만 허용 목록에 추가되고, 확인 전에는 아무 파일도 분석하지 않습니다.</p>

	{#if error}<div class="mt-2"><Notice tone="danger">{error}</Notice></div>{/if}
	{#if result}
		{#if !result.available || result.reason}
			<div class="mt-2"><Notice tone={result.available ? 'info' : 'warning'}>{result.reason}{#if !result.available} <a href="/api/drive/connect" data-sveltekit-reload>Drive 다시 연결</a>{/if}</Notice></div>
		{/if}
		{#if result.keywords.length}<p class="mt-2 text-sm text-muted">검색어: {result.keywords.join(', ')}</p>{/if}
		{#if result.candidates.length}
			<ul class="mt-2 space-y-2" aria-label="Drive 후보 파일">
				{#each result.candidates as c (c.fileId)}
					<li class="flex flex-wrap items-center gap-2 rounded-[8px] border border-border p-2">
						<FileSpreadsheet size={18} aria-hidden="true" class="shrink-0 text-muted" />
						<span class="min-w-0 flex-1">
							<span class="block font-semibold break-words">{c.name}</span>
							<span class="block text-sm text-muted">{mimeLabel(c.mimeType)} · 수정 {fmtDateTime(c.modifiedAt)}{c.folder ? ` · ${c.folder}` : ''}{c.alreadyAllowed ? ' · 이미 허용됨' : ''}</span>
						</span>
						{#if c.webViewLink}<a href={c.webViewLink} target="_blank" rel="noopener noreferrer" class="text-sm" aria-label="{c.name} Drive에서 열기"><ExternalLink size={16} aria-hidden="true" /></a>{/if}
						<Button size="sm" onclick={() => use(c)} disabled={disabled || adding !== null}>{adding === c.fileId ? '추가 중…' : '이 파일 사용'}</Button>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>
