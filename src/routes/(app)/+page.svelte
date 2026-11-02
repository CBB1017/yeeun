<script lang="ts">
	import type { PageProps } from './$types';
	import { goto } from '$app/navigation';
	import { ChevronRight, CalendarClock, Plus, X, FileArchive, FileText, CircleAlert, LoaderCircle, Upload } from '@lucide/svelte';
	import Button from '#lib/components/Button.svelte';
	import Notice from '#lib/components/Notice.svelte';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { api, messageOf } from '#lib/client/api.ts';
	import { announce } from '#lib/client/live.svelte.ts';
	import { Attachments, fmtSize } from '#lib/client/attachments.svelte.ts';
	import { SKIP_REASON_LABEL, UPLOAD_ACCEPT } from '#lib/shared/uploads.ts';
	import { browserTimezone, describeRule, fmtDateTime, stateInfo, TRIGGER_LABEL } from '#lib/client/format.ts';
	import type { Draft, PublicRun } from '#lib/client/types.ts';

	let { data }: PageProps = $props();
	const me = $derived(data.me);
	const tz = browserTimezone();

	let prompt = $state('');
	let busy = $state(false);
	let err = $state('');

	// ---------- files attached from the PC (+ button, drag and drop, Ctrl+V) ----------
	// svelte-ignore state_referenced_locally
	const attachments = new Attachments(data.uploadLimits);
	let fileInput = $state<HTMLInputElement>();
	let dragDepth = $state(0);
	let attachMsgs = $state<string[]>([]);
	const dragging = $derived(dragDepth > 0);

	function attach(files: File[], how: 'pick' | 'drop' | 'paste') {
		if (!files.length) return;
		const rejected = attachments.add(files, { renamePasted: how === 'paste' });
		attachMsgs = rejected;
		const accepted = files.length - rejected.length;
		announce(
			accepted > 0
				? `${accepted}개 파일을 첨부하는 중입니다${rejected.length ? `, ${rejected.length}개는 첨부하지 못했습니다` : ''}`
				: '파일을 첨부하지 못했습니다'
		);
	}

	function onPick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		attach([...(input.files ?? [])], 'pick');
		input.value = '';
	}

	const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');

	function onDragEnter(e: DragEvent) {
		if (!hasFiles(e)) return;
		e.preventDefault();
		dragDepth++;
	}
	function onDragOver(e: DragEvent) {
		if (!hasFiles(e)) return;
		e.preventDefault();
		e.dataTransfer!.dropEffect = 'copy';
	}
	function onDragLeave(e: DragEvent) {
		if (!hasFiles(e)) return;
		dragDepth = Math.max(0, dragDepth - 1);
	}
	function onDrop(e: DragEvent) {
		if (!hasFiles(e)) return;
		e.preventDefault();
		e.stopPropagation();
		dragDepth = 0;
		const dt = e.dataTransfer!;
		// A dropped folder arrives as an empty entry; say so instead of uploading nothing.
		const folders = new Set(
			[...dt.items]
				.map((it) => (it.kind === 'file' ? it.webkitGetAsEntry?.() : null))
				.filter((en): en is FileSystemEntry => !!en && en.isDirectory)
				.map((en) => en.name)
		);
		attach(
			[...dt.files].filter((f) => !folders.has(f.name)),
			'drop'
		);
		if (folders.size) attachMsgs = [...attachMsgs, ...[...folders].map((n) => `"${n}": 폴더는 바로 첨부할 수 없습니다. zip으로 압축해 첨부하세요.`)];
	}

	/** Dropping outside the box must not make the browser open (navigate to) the file. */
	function onWindowDragOver(e: DragEvent) {
		if (hasFiles(e)) e.preventDefault();
	}
	function onWindowDrop(e: DragEvent) {
		if (hasFiles(e)) {
			e.preventDefault();
			dragDepth = 0;
		}
	}

	/**
	 * Ctrl+V: copied files (e.g. from Explorer/Finder) or a screenshot are attached.
	 * When the clipboard also carries text (cells copied from Excel come with a
	 * picture of the cells) the text is pasted as usual and nothing is attached.
	 */
	function onWindowPaste(e: ClipboardEvent) {
		const dt = e.clipboardData;
		if (!dt || dt.files.length === 0) return;
		const t = e.target as HTMLElement | null;
		const editable = !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
		if (editable && t.id !== 'prompt') return;
		if (dt.getData('text/plain').trim()) return;
		e.preventDefault();
		attach([...dt.files], 'paste');
	}

	async function removeAttachment(key: string, name: string) {
		const msg = await attachments.remove(key);
		announce(`${name}을(를) 첨부에서 뺐습니다`);
		if (msg) attachMsgs = [...attachMsgs, msg];
	}

	const attention = $derived(data.runs.filter((r) => ['review', 'error'].includes(stateInfo(r.state).group)));
	const active = $derived(data.runs.filter((r) => stateInfo(r.state).group === 'progress'));
	const recent = $derived(data.runs.slice(0, 10));
	const visibleTasks = $derived(data.tasks.filter((t) => t.status !== 'archived'));
	const scheduled = $derived(visibleTasks.filter((t) => t.schedule));

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		err = '';
		if (!prompt.trim()) {
			err = attachments.items.length ? '첨부한 파일로 무엇을 할지 요청 내용을 입력하세요.' : '요청 내용을 입력하세요.';
			return;
		}
		if (attachments.uploading) {
			err = '파일 업로드가 끝난 뒤 다시 누르세요.';
			return;
		}
		if (attachments.hasErrors) {
			err = '업로드하지 못한 파일이 있습니다. 해당 파일을 빼거나 다시 첨부하세요.';
			return;
		}
		if (attachments.overLimit) {
			err = `한 요청에는 파일을 최대 ${attachments.limits.maxAttachments}개까지 사용할 수 있습니다 (지금 ${attachments.fileCount}개).`;
			return;
		}
		busy = true;
		try {
			const uploadIds = attachments.uploadIds;
			const d = await api<Draft>('/api/task-drafts', {
				method: 'POST',
				body: { prompt: prompt.trim(), timezone: tz, ...(uploadIds.length ? { upload_ids: uploadIds } : {}) }
			});
			attachments.clear();
			await goto(`/drafts/${d.id}`);
		} catch (e2) {
			err = messageOf(e2);
		} finally {
			busy = false;
		}
	}

	const TASK_STATUS: Record<string, string> = { active: '사용 중', paused: '일시중지', archived: '보관됨' };
</script>

<svelte:head>
	<title>홈 · Yeeun</title>
</svelte:head>

{#snippet runRow(r: PublicRun)}
	<li>
		<a href="/runs/{r.id}" class="flex min-h-11 items-center gap-3 rounded-[8px] px-3 py-2 text-ink no-underline hover:bg-subtle hover:text-ink">
			<span class="min-w-0 flex-1">
				<span class="block truncate font-semibold">{r.title ?? '업무'}</span>
				<span class="block text-sm text-muted">{TRIGGER_LABEL[r.trigger] ?? r.trigger} · {fmtDateTime(r.createdAt)}{r.late ? ' · 지연 실행' : ''}</span>
			</span>
			<StatusBadge state={r.state} />
			<ChevronRight size={18} class="flex-none text-muted" />
		</a>
	</li>
{/snippet}

<svelte:window ondragover={onWindowDragOver} ondrop={onWindowDrop} onpaste={onWindowPaste} />

<h1 class="sr-only">홈</h1>

<div class="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
	<div class="min-w-0 space-y-5">
		{#if !me.capabilities.execution_available}
			<Notice tone="warning" title="새 실행이 지금은 진행되지 않을 수 있습니다" testid="capability-notice">
				<p>{me.capabilities.message ?? '소유자 CLI 실행 환경이 준비되지 않았습니다.'}</p>
				{#if me.user.role === 'admin'}
					<p><a href="/admin#capabilities">관리 화면에서 실행 환경 상태 보기</a></p>
				{/if}
			</Notice>
		{/if}

		<section
			class="card relative"
			aria-labelledby="ask-title"
			ondragenter={onDragEnter}
			ondragover={onDragOver}
			ondragleave={onDragLeave}
			ondrop={onDrop}
			data-testid="prompt-card"
		>
			<form onsubmit={submit} class="space-y-3" novalidate>
				<label for="prompt" id="ask-title" class="section-title block">무엇을 정리할까요?</label>
				<p id="prompt-help" class="hint">
					허용한 Drive 파일이나 PC에서 첨부한 파일로 할 일을 평소 말투로 적으세요. 예: “마감일 목록에서 오늘부터 30일 안에 마감인 항목을 정리해줘”, “매출 파일의 지역별 합계를 엑셀로”. 다음 화면에서 해석한 계획을 확인·수정한 뒤에만 실행합니다.
				</p>
				<textarea
					id="prompt"
					name="prompt"
					class="input min-h-28"
					bind:value={prompt}
					aria-describedby="prompt-help attach-help{err ? ' prompt-error' : ''}"
					aria-invalid={err ? 'true' : undefined}
					maxlength={20000}
					data-testid="prompt-input"
				></textarea>

				{#if attachments.items.length}
					<ul class="space-y-2" aria-label="첨부한 파일" data-testid="attachment-list">
						{#each attachments.items as a (a.key)}
							<li class="rounded-[8px] border border-line-soft bg-subtle px-3 py-2" data-testid="attachment" data-status={a.status}>
								<div class="flex items-center gap-3">
									{#if a.status === 'uploading'}
										<LoaderCircle size={18} class="flex-none animate-spin text-muted motion-reduce:animate-none" aria-hidden="true" />
									{:else if a.status === 'error'}
										<CircleAlert size={18} class="flex-none text-danger" aria-hidden="true" />
									{:else if a.isZip}
										<FileArchive size={18} class="flex-none text-primary" aria-hidden="true" />
									{:else}
										<FileText size={18} class="flex-none text-primary" aria-hidden="true" />
									{/if}
									<span class="min-w-0 flex-1">
										<span class="block truncate font-semibold" title={a.name}>{a.name}</span>
										<span class="block text-sm text-muted">
											{fmtSize(a.size)} ·
											{#if a.status === 'uploading'}
												업로드 중 {Math.round(a.progress * 100)}%
											{:else if a.status === 'error'}
												<span class="font-semibold text-danger">{a.error}</span>
											{:else if a.isZip}
												압축을 풀어 파일 {a.files.length}개 첨부{a.skipped.length ? ` · ${a.skipped.length}개 제외` : ''}
											{:else}
												첨부됨
											{/if}
										</span>
									</span>
									<button
										type="button"
										class="inline-flex size-11 flex-none items-center justify-center rounded-[8px] text-muted hover:bg-surface hover:text-ink"
										onclick={() => removeAttachment(a.key, a.name)}
										aria-label="{a.name} 첨부 빼기"
										data-testid="attachment-remove"
									>
										<X size={18} aria-hidden="true" />
									</button>
								</div>
								{#if a.status === 'uploading'}
									<div class="mt-2 h-1 overflow-hidden rounded bg-line-soft" aria-hidden="true">
										<div class="h-full bg-primary transition-[width]" style:width="{Math.round(a.progress * 100)}%"></div>
									</div>
								{/if}
								{#if a.isZip && a.status === 'done'}
									<details class="mt-1 text-sm" open={a.skipped.length > 0}>
										<summary class="cursor-pointer text-primary">zip 안의 파일 보기</summary>
										<ul class="mt-1 space-y-0.5 pl-1" data-testid="zip-contents">
											{#each a.files as f (f.id)}<li class="break-words">✓ {f.displayName} <span class="text-muted">({fmtSize(f.sizeBytes)})</span></li>{/each}
											{#each a.skipped as sk (sk.name)}<li class="break-words text-muted">제외: {sk.name} — {SKIP_REASON_LABEL[sk.reason]}</li>{/each}
										</ul>
									</details>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
				{#if attachMsgs.length}
					<div class="rounded-[8px] bg-warning-soft px-3 py-2 text-sm text-warning" role="alert" data-testid="attach-errors">
						<ul class="space-y-0.5">
							{#each attachMsgs as m, i (i)}<li>{m}</li>{/each}
						</ul>
					</div>
				{/if}

				{#if err}<p id="prompt-error" class="text-sm font-semibold text-danger" role="alert">{err}</p>{/if}
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
						<Button
							onclick={() => fileInput?.click()}
							disabled={busy || attachments.fileCount >= attachments.limits.maxAttachments}
							aria-label="PC에서 파일 첨부"
							aria-describedby="attach-help"
							data-testid="attach-button"
						>
							<Plus size={18} aria-hidden="true" />파일
						</Button>
						<input
							bind:this={fileInput}
							type="file"
							class="sr-only"
							multiple
							accept={UPLOAD_ACCEPT}
							tabindex="-1"
							aria-hidden="true"
							onchange={onPick}
							data-testid="attach-input"
						/>
						<p id="attach-help" class="hint min-w-0">끌어다 놓거나 Ctrl+V로 붙여 넣어도 됩니다 · 엑셀·PPT·워드·한글·PDF·CSV·이미지·zip, 최대 {attachments.limits.maxAttachments}개</p>
					</div>
					<Button type="submit" variant="primary" disabled={busy || attachments.uploading} aria-busy={busy} data-testid="prompt-submit">
						{busy ? '해석 중…' : attachments.uploading ? '업로드 중…' : '계획 만들기'}
					</Button>
				</div>
				<p class="hint">시간대: <span class="font-semibold text-ink">{tz}</span> (브라우저 기준, 다음 단계에서 확인)</p>
				{#if data.grantCount === 0 && attachments.items.length === 0}
					<Notice tone="info">
						<p>아직 허용한 Drive 파일이 없습니다. <strong>+ 파일</strong>로 PC의 파일을 첨부하거나 Drive 파일을 허용해 쓰세요. <a href="/files">Drive 파일 허용하기</a></p>
					</Notice>
				{/if}
			</form>
			{#if dragging}
				<div
					class="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-[8px] border-2 border-dashed border-primary bg-primary-soft text-primary"
					data-testid="drop-overlay"
				>
					<Upload size={28} aria-hidden="true" />
					<p class="font-semibold">여기에 놓으면 첨부됩니다</p>
					<p class="text-sm">엑셀·PPT·PDF·CSV·이미지·zip</p>
				</div>
			{/if}
		</section>

		{#if attention.length}
			<section class="card" aria-labelledby="attention-title">
				<h2 id="attention-title" class="section-title">확인이 필요한 실행 <span class="text-muted">({attention.length})</span></h2>
				<p class="hint">검토가 필요하거나 오류로 끝난 실행입니다. 자동으로 다시 실행하지 않습니다.</p>
				<ul class="mt-2 -mx-3">
					{#each attention as r (r.id)}{@render runRow(r)}{/each}
				</ul>
			</section>
		{/if}

		{#if active.length}
			<section class="card" aria-labelledby="active-title">
				<h2 id="active-title" class="section-title">진행 중 <span class="text-muted">({active.length})</span></h2>
				<ul class="mt-2 -mx-3">
					{#each active as r (r.id)}{@render runRow(r)}{/each}
				</ul>
			</section>
		{/if}

		<section class="card" aria-labelledby="tasks-title">
			<h2 id="tasks-title" class="section-title">내 업무</h2>
			{#if visibleTasks.length === 0}
				<div class="mt-3">
					<EmptyState title="아직 저장한 업무가 없습니다">위 입력란에 할 일을 적으면 계획을 만들어 드립니다.</EmptyState>
				</div>
			{:else}
				<ul class="mt-2 -mx-3" data-testid="task-list">
					{#each visibleTasks as t (t.id)}
						<li>
							<a href="/tasks/{t.id}" class="flex min-h-11 items-center gap-3 rounded-[8px] px-3 py-2 text-ink no-underline hover:bg-subtle hover:text-ink">
								<span class="min-w-0 flex-1">
									<span class="block truncate font-semibold">{t.title}</span>
									<span class="block text-sm text-muted">
										{TASK_STATUS[t.status]} ·
										{#if t.schedule}{describeRule(t.schedule.rule)} ({t.schedule.timezone}){:else}직접 실행{/if}
									</span>
								</span>
								<ChevronRight size={18} class="flex-none text-muted" />
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>

	<div class="min-w-0 space-y-5">
		<section class="card" aria-labelledby="sched-title">
			<h2 id="sched-title" class="section-title flex items-center gap-2"><CalendarClock size={20} /> 예약</h2>
			{#if scheduled.length === 0}
				<p class="hint mt-2">예약된 업무가 없습니다. 반복 요일·시각은 요청에 적었을 때만 설정합니다.</p>
			{:else}
				<ul class="mt-2 space-y-3">
					{#each scheduled as t (t.id)}
						<li class="min-w-0">
							<a href="/tasks/{t.id}" class="font-semibold">{t.title}</a>
							<p class="text-sm text-muted">{describeRule(t.schedule!.rule)} · {t.schedule!.timezone}</p>
							<p class="text-sm">
								{#if t.schedule!.active && t.status === 'active'}
									다음 실행: {fmtDateTime(t.schedule!.nextDueAt, t.schedule!.timezone)}
								{:else}
									일시중지됨
								{/if}
							</p>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="card" aria-labelledby="recent-title">
			<h2 id="recent-title" class="section-title">최근 실행</h2>
			{#if recent.length === 0}
				<p class="hint mt-2">아직 실행 기록이 없습니다.</p>
			{:else}
				<ul class="mt-2 -mx-3" data-testid="recent-runs">
					{#each recent as r (r.id)}{@render runRow(r)}{/each}
				</ul>
			{/if}
		</section>
	</div>
</div>
