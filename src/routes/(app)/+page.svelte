<script lang="ts">
	import type { PageProps } from './$types';
	import { goto } from '$app/navigation';
	import { ChevronRight, CalendarClock } from '@lucide/svelte';
	import Button from '#lib/components/Button.svelte';
	import Notice from '#lib/components/Notice.svelte';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { api, messageOf } from '#lib/client/api.ts';
	import { browserTimezone, describeRule, fmtDateTime, stateInfo, TRIGGER_LABEL } from '#lib/client/format.ts';
	import type { Draft, PublicRun } from '#lib/client/types.ts';

	let { data }: PageProps = $props();
	const me = $derived(data.me);
	const tz = browserTimezone();

	let prompt = $state('');
	let busy = $state(false);
	let err = $state('');

	const attention = $derived(data.runs.filter((r) => ['review', 'error'].includes(stateInfo(r.state).group)));
	const active = $derived(data.runs.filter((r) => stateInfo(r.state).group === 'progress'));
	const recent = $derived(data.runs.slice(0, 10));
	const visibleTasks = $derived(data.tasks.filter((t) => t.status !== 'archived'));
	const scheduled = $derived(visibleTasks.filter((t) => t.schedule));

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		err = '';
		if (!prompt.trim()) {
			err = '요청 내용을 입력하세요.';
			return;
		}
		busy = true;
		try {
			const d = await api<Draft>('/api/task-drafts', { method: 'POST', body: { prompt: prompt.trim(), timezone: tz } });
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

		<section class="card" aria-labelledby="ask-title">
			<form onsubmit={submit} class="space-y-3" novalidate>
				<label for="prompt" id="ask-title" class="section-title block">무엇을 정리할까요?</label>
				<p id="prompt-help" class="hint">
					허용한 파일로 할 일을 평소 말투로 적으세요. 예: “마감일 목록에서 오늘부터 30일 안에 마감인 항목을 정리해줘”, “매출 파일의 지역별 합계를 엑셀로”. 다음 화면에서 해석한 계획을 확인·수정한 뒤에만 실행합니다.
				</p>
				<textarea
					id="prompt"
					name="prompt"
					class="input min-h-28"
					bind:value={prompt}
					aria-describedby="prompt-help{err ? ' prompt-error' : ''}"
					aria-invalid={err ? 'true' : undefined}
					maxlength={20000}
					data-testid="prompt-input"
				></textarea>
				{#if err}<p id="prompt-error" class="text-sm font-semibold text-danger" role="alert">{err}</p>{/if}
				<div class="flex flex-wrap items-center justify-between gap-3">
					<p class="hint">시간대: <span class="font-semibold text-ink">{tz}</span> (브라우저 기준, 다음 단계에서 확인)</p>
					<Button type="submit" variant="primary" disabled={busy} aria-busy={busy} data-testid="prompt-submit">{busy ? '해석 중…' : '계획 만들기'}</Button>
				</div>
				{#if data.grantCount === 0}
					<Notice tone="info">
						<p>아직 허용한 파일이 없습니다. 앱은 직접 허용한 Drive 파일만 읽을 수 있습니다. <a href="/files">파일 허용하기</a></p>
					</Notice>
				{/if}
			</form>
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
