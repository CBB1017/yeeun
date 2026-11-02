<script lang="ts">
	import type { PageProps } from './$types';
	import { page } from '$app/state';
	import { invalidate } from '$app/navigation';
	import { Plus, ExternalLink, Search, Link2 } from '@lucide/svelte';
	import Button from '#lib/components/Button.svelte';
	import Notice from '#lib/components/Notice.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { api, messageOf } from '#lib/client/api.ts';
	import { announce } from '#lib/client/live.svelte.ts';
	import { pickDriveFiles, type PickerConfig } from '#lib/client/picker.ts';
	import { fmtDateTime, mimeLabel, errorInfo } from '#lib/client/format.ts';
	import type { Grant } from '#lib/client/types.ts';

	let { data }: PageProps = $props();
	const me = $derived(data.me);
	const connection = $derived(data.connection);

	let q = $state('');
	let searched = $state<Grant[] | null>(null);
	let searching = $state(false);
	let picking = $state(false);
	let pickMsg = $state<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null);
	let removeTarget = $state<Grant | null>(null);
	let removeOpen = $state(false);
	let disconnectOpen = $state(false);

	const urlError = $derived(page.url.searchParams.get('error'));
	const connected = $derived(page.url.searchParams.get('connected') === '1');
	const list = $derived(searched ?? data.grants);

	let timer: ReturnType<typeof setTimeout> | undefined;
	function onSearchInput() {
		if (timer) clearTimeout(timer);
		timer = setTimeout(runSearch, 250);
	}
	async function runSearch() {
		if (!q.trim()) {
			searched = null;
			return;
		}
		searching = true;
		try {
			const r = await api<{ scope: string; files: Grant[] }>(`/api/drive/files?q=${encodeURIComponent(q.trim())}`);
			searched = r.files;
			announce(`허용된 파일 중 ${r.files.length}개가 검색되었습니다`);
		} catch (e) {
			pickMsg = { tone: 'danger', text: messageOf(e) };
		} finally {
			searching = false;
		}
	}

	async function addFiles() {
		pickMsg = null;
		picking = true;
		try {
			const cfg = await api<PickerConfig>('/api/drive/picker-config');
			const ids = await pickDriveFiles(cfg);
			if (!ids || ids.length === 0) {
				pickMsg = { tone: 'warning', text: '파일을 선택하지 않았습니다.' };
				return;
			}
			const r = await api<{ added: Grant[]; rejected: { id: string; reason: string }[] }>('/api/drive/grants', { method: 'POST', body: { fileIds: ids } });
			const rejected = r.rejected.length ? ` ${r.rejected.length}개는 확인하지 못해 추가하지 않았습니다 (${[...new Set(r.rejected.map((x) => errorInfo(x.reason).title))].join(', ')}).` : '';
			pickMsg = { tone: r.rejected.length ? 'warning' : 'success', text: `${r.added.length}개 파일을 허용 목록에 추가했습니다.${rejected}` };
			announce(pickMsg.text);
			await invalidate('app:files');
			searched = null;
		} catch (e) {
			pickMsg = { tone: 'danger', text: messageOf(e) };
		} finally {
			picking = false;
		}
	}

	async function removeGrant() {
		if (!removeTarget) return;
		await api(`/api/drive/grants/${removeTarget.id}`, { method: 'DELETE' });
		announce(`${removeTarget.name} 허용을 취소했습니다`);
		searched = searched?.filter((g) => g.id !== removeTarget!.id) ?? null;
		await invalidate('app:files');
	}

	async function disconnect() {
		await api('/api/drive/connection', { method: 'DELETE' });
		announce('Drive 연결을 해제했습니다');
		searched = null;
		await invalidate('app:files');
	}

	const URL_ERRORS: Record<string, string> = {
		NOT_CONFIGURED: '운영자가 Google 연동을 아직 설정하지 않아 Drive를 연결할 수 없습니다.',
		DRIVE_REAUTH_REQUIRED: 'Drive 파일 권한(drive.file)에 동의하지 않았거나 연결이 완료되지 않았습니다. 다시 연결하세요.'
	};
</script>

<svelte:head>
	<title>허용한 파일 · Yeeun</title>
</svelte:head>

<div class="max-w-5xl">
	<PageHeader title="허용한 파일" description="앱은 여기에서 직접 허용한 Google Drive 파일만 읽습니다. 전체 Drive를 검색하거나 다른 파일을 몰래 가져오지 않습니다." />

	<div class="space-y-5">
		{#if urlError}
			<Notice tone="danger" title="Drive를 연결하지 못했습니다" role="alert">
				<p>{URL_ERRORS[urlError] ?? errorInfo(urlError).title}</p>
			</Notice>
		{:else if connected}
			<Notice tone="success" title="Drive를 연결했습니다" role="status"><p>이제 “파일 추가”로 사용할 파일을 고르세요.</p></Notice>
		{/if}

		<section class="card" aria-labelledby="conn-title">
			<h2 id="conn-title" class="section-title flex items-center gap-2"><Link2 size={20} /> Drive 연결</h2>
			{#if !connection}
				<p class="mt-2">아직 Drive가 연결되지 않았습니다. 연결할 때는 <strong>앱에서 고른 파일만 읽는 권한(drive.file)</strong>만 요청합니다.</p>
				{#if !me.features.google}
					<Notice tone="warning" class="mt-3"><p>운영자가 Google 연동을 설정하지 않아 지금은 연결할 수 없습니다.</p></Notice>
				{/if}
				<div class="mt-3">
					<Button variant="primary" href="/api/drive/connect" reload data-testid="drive-connect">Drive 연결</Button>
				</div>
			{:else}
				<dl class="kv mt-3">
					<dt>계정</dt>
					<dd class="font-semibold">{connection.email ?? '(이메일 정보 없음)'}</dd>
					<dt>상태</dt>
					<dd>{connection.status === 'active' ? '연결됨' : '다시 연결 필요'}</dd>
					<dt>연결 시각</dt>
					<dd>{fmtDateTime(connection.createdAt)}</dd>
				</dl>
				{#if connection.status === 'reauth_required'}
					<Notice tone="warning" class="mt-3" title="Drive 권한을 다시 확인해야 합니다">
						<p>권한이 만료되었거나 취소되었습니다. 이 파일을 쓰는 예약은 실행되지 않고 오류로 알립니다.</p>
						{#snippet actions()}<Button variant="primary" href="/api/drive/connect" reload>다시 연결</Button>{/snippet}
					</Notice>
				{/if}
				<div class="mt-4 flex flex-wrap gap-2">
					<Button variant="primary" onclick={addFiles} disabled={picking || !me.features.picker || connection.status !== 'active'} aria-busy={picking} data-testid="add-files">
						<Plus size={18} />{picking ? '파일 선택 창 여는 중…' : '파일 추가'}
					</Button>
					<Button variant="danger-outline" onclick={() => (disconnectOpen = true)} data-testid="drive-disconnect">연결 해제</Button>
				</div>
				{#if !me.features.picker}
					<p class="hint mt-2">운영자가 Google Picker를 설정하지 않아 파일을 추가할 수 없습니다.</p>
				{/if}
			{/if}
			{#if pickMsg}
				<Notice tone={pickMsg.tone} class="mt-3" role={pickMsg.tone === 'danger' ? 'alert' : 'status'}><p>{pickMsg.text}</p></Notice>
			{/if}
		</section>

		<section class="card" aria-labelledby="list-title">
			<div class="flex flex-wrap items-end justify-between gap-3">
				<h2 id="list-title" class="section-title">허용 목록 <span class="text-muted">({data.grants.length})</span></h2>
			</div>
			{#if data.grants.length === 0}
				<div class="mt-3">
					<EmptyState title="허용한 파일이 없습니다" testid="files-empty">
						<p>업무에 쓸 Drive 파일을 직접 골라 추가하세요. 추가하지 않은 파일은 앱이 볼 수 없습니다.</p>
						{#snippet actions()}
							{#if connection}
								<Button variant="primary" onclick={addFiles} disabled={picking || !me.features.picker}><Plus size={18} />파일 추가</Button>
							{:else}
								<Button variant="primary" href="/api/drive/connect" reload>Drive 연결 후 파일 추가</Button>
							{/if}
						{/snippet}
					</EmptyState>
				</div>
			{:else}
				<div class="mt-3" role="search">
					<label for="grant-search" class="label">허용된 파일만 검색</label>
					<div class="relative">
						<Search size={18} class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
						<input id="grant-search" type="search" class="input pl-10" bind:value={q} oninput={onSearchInput} aria-describedby="search-scope" autocomplete="off" data-testid="grant-search" />
					</div>
					<p id="search-scope" class="hint mt-1">검색 범위: 위 허용 목록의 파일 이름만. Drive 전체를 검색하지 않습니다.{searching ? ' 검색 중…' : ''}</p>
				</div>

				{#if list.length === 0}
					<p class="mt-4" role="status">허용 목록에서 “{q}”와 맞는 파일이 없습니다. 필요한 파일이면 “파일 추가”로 직접 허용하세요.</p>
				{:else}
					<ul class="mt-4 divide-y divide-line-soft" data-testid="grant-list">
						{#each list as g (g.id)}
							<li class="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
								<div class="min-w-0">
									<p class="font-semibold break-words">{g.name}</p>
									<p class="text-sm text-muted">
										{mimeLabel(g.mimeType)} · 수정 {fmtDateTime(g.modifiedAt)}{g.folderLabel ? ` · 폴더 ${g.folderLabel}` : ''} · 허용 {fmtDateTime(g.createdAt)}
									</p>
								</div>
								<div class="flex flex-none flex-wrap gap-2">
									{#if g.webViewLink}
										<Button size="sm" href={g.webViewLink} target="_blank" rel="noopener noreferrer" aria-label="{g.name} Drive에서 열기 (새 창)"><ExternalLink size={16} />Drive에서 열기</Button>
									{/if}
									<Button size="sm" variant="danger-outline" onclick={() => ((removeTarget = g), (removeOpen = true))} aria-label="{g.name} 허용 취소">허용 취소</Button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		</section>
	</div>
</div>

<ConfirmDialog bind:open={removeOpen} title="파일 허용을 취소할까요?" confirmLabel="허용 취소" tone="danger" onconfirm={removeGrant} testid="confirm-remove-grant">
	<p><strong class="break-words">{removeTarget?.name}</strong>을(를) 허용 목록에서 뺍니다.</p>
	<ul class="list-disc space-y-1 pl-5 text-[0.9375rem]">
		<li>앞으로 앱이 이 파일을 읽지 않습니다. Drive의 원본 파일은 삭제되지 않습니다.</li>
		<li>이 파일을 쓰는 업무의 예약은 일시중지됩니다. 다른 파일로 자동 대체하지 않습니다.</li>
		<li>이미 만든 결과와 근거는 그대로 남습니다.</li>
	</ul>
</ConfirmDialog>

<ConfirmDialog bind:open={disconnectOpen} title="Drive 연결을 해제할까요?" confirmLabel="연결 해제" tone="danger" onconfirm={disconnect} testid="confirm-disconnect">
	<ul class="list-disc space-y-1 pl-5 text-[0.9375rem]">
		<li>Google에 발급된 접근 권한을 취소하고, 허용 목록의 모든 파일을 더 이상 읽지 않습니다.</li>
		<li>이 파일들을 쓰는 업무의 예약이 일시중지됩니다.</li>
		<li>지금까지의 결과·다운로드·근거는 계속 볼 수 있습니다. Drive 원본은 바뀌지 않습니다.</li>
	</ul>
</ConfirmDialog>
