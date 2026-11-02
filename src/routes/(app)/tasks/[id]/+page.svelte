<script lang="ts">
	import type { PageProps } from './$types';
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import { Play, Pause, Archive, BellOff, CalendarClock } from '@lucide/svelte';
	import Button from '#lib/components/Button.svelte';
	import Notice from '#lib/components/Notice.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import { api, messageOf, newIdempotencyKey } from '#lib/client/api.ts';
	import { announce } from '#lib/client/live.svelte.ts';
	import { describeOperation, describeRule, fmtDateTime, mimeLabel, FORMAT_LABEL, TRIGGER_LABEL } from '#lib/client/format.ts';
	import type { PublicRun } from '#lib/client/types.ts';

	let { data }: PageProps = $props();
	const task = $derived(data.detail.task);
	const schedule = $derived(data.detail.schedule);
	const plan = $derived(task.plan);

	let runBusy = $state(false);
	let msg = $state<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null);
	let archiveOpen = $state(false);
	let muteUntil = $state<string | null>(null);
	let muteBusy = $state(false);

	const STATUS = { active: { label: '사용 중', tone: 'success' }, paused: { label: '일시중지', tone: 'warning' }, archived: { label: '보관됨', tone: 'neutral' } } as const;

	async function runNow() {
		runBusy = true;
		msg = null;
		try {
			const r = await api<{ run: PublicRun; duplicate: boolean }>(`/api/tasks/${task.id}/runs`, { method: 'POST', idempotencyKey: newIdempotencyKey('run') });
			await goto(`/runs/${r.run.id}`);
		} catch (e) {
			msg = { tone: 'danger', text: messageOf(e) };
		} finally {
			runBusy = false;
		}
	}

	async function setStatus(status: 'active' | 'paused' | 'archived') {
		msg = null;
		try {
			await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: { status } });
			await invalidate('app:task');
			const t = status === 'active' ? '업무를 재개했습니다. 지금 이후의 예약만 실행하며 멈춘 동안의 실행은 하지 않습니다.' : status === 'paused' ? '업무를 일시중지했습니다. 예약 실행이 멈춥니다.' : '업무를 보관했습니다.';
			msg = { tone: 'success', text: t };
			announce(t);
		} catch (e) {
			msg = { tone: 'danger', text: messageOf(e) };
		}
	}

	async function muteToday() {
		muteBusy = true;
		msg = null;
		try {
			const r = await api<{ taskId: string; muteUntil: string }>(`/api/tasks/${task.id}/mute-today`, { method: 'POST' });
			muteUntil = r.muteUntil;
			announce(`오늘 이 업무의 정상 알림을 ${fmtDateTime(r.muteUntil, 'Asia/Seoul')}까지 끕니다`);
		} catch (e) {
			msg = { tone: 'danger', text: messageOf(e) };
		} finally {
			muteBusy = false;
		}
	}
</script>

<svelte:head>
	<title>{task.title} · 업무 · Yeeun</title>
</svelte:head>

<div class="max-w-5xl">
	<PageHeader title={task.title} back={{ href: '/', label: '홈' }}>
		{#snippet meta()}
			<StatusBadge tone={STATUS[task.status].tone} label={STATUS[task.status].label} />
			<span class="text-sm text-muted">계획 버전 {task.planRevision} · 확인 {fmtDateTime(task.confirmedAt)}</span>
		{/snippet}
		{#snippet actions()}
			<Button variant="primary" onclick={runNow} disabled={runBusy || task.status === 'archived'} aria-busy={runBusy} data-testid="run-now"><Play size={18} />{runBusy ? '요청 중…' : '지금 실행'}</Button>
			{#if task.status === 'active'}
				<Button onclick={() => setStatus('paused')} data-testid="pause-task"><Pause size={18} />일시중지</Button>
			{:else if task.status === 'paused'}
				<Button onclick={() => setStatus('active')} data-testid="resume-task"><Play size={18} />재개</Button>
			{/if}
			{#if task.status !== 'archived'}
				<Button variant="danger-outline" onclick={() => (archiveOpen = true)}><Archive size={18} />보관</Button>
			{/if}
		{/snippet}
	</PageHeader>

	<div class="space-y-5">
		{#if page.url.searchParams.get('created') === '1'}
			<Notice tone="success" title="업무를 저장했습니다" role="status">
				<p>{schedule ? '정한 시각에 자동으로 실행합니다.' : '실행하려면 “지금 실행”을 누르세요.'}</p>
			</Notice>
		{/if}
		{#if msg}
			<Notice tone={msg.tone} role={msg.tone === 'danger' ? 'alert' : 'status'}><p>{msg.text}</p></Notice>
		{/if}
		<p class="hint">“지금 실행”은 매번 Drive에서 원본을 새로 가져오는 새 실행입니다. 실패한 실행을 자동으로 다시 시도하지 않습니다.</p>

		<div class="grid gap-5 lg:grid-cols-2">
			<section class="card" aria-labelledby="plan-title">
				<h2 id="plan-title" class="section-title">계획 요약</h2>
				<dl class="kv mt-3">
					<dt>목표</dt>
					<dd class="whitespace-pre-wrap">{plan.goal}</dd>
					<dt>원본 파일</dt>
					<dd>
						<ul>
							{#each plan.sources as s, i (s.grant_id)}
								<li class="break-words">{i + 1}. {s.name} <span class="text-sm text-muted">({mimeLabel(s.mime_type)}{s.selector.sheet ? `, 시트 ${s.selector.sheet}` : ''})</span></li>
							{/each}
						</ul>
					</dd>
					<dt>작업</dt>
					<dd>
						<ol class="list-decimal pl-5">
							{#each plan.operations as op, i (i)}<li class="break-words">{describeOperation(op, plan)}</li>{/each}
						</ol>
					</dd>
					<dt>결과물</dt>
					<dd>웹 화면{plan.outputs.downloads.length ? ` + ${plan.outputs.downloads.map((f) => FORMAT_LABEL[f]).join(', ')}` : ''}</dd>
					<dt>알림</dt>
					<dd>{[plan.notifications.email && '이메일', plan.notifications.push && '브라우저 푸시'].filter(Boolean).join(', ') || '받지 않음'}</dd>
					<dt>날짜 기준</dt>
					<dd>실행 시작일 ({plan.date_policy.timezone})</dd>
				</dl>
			</section>

			<section class="card" aria-labelledby="sched-title">
				<h2 id="sched-title" class="section-title flex items-center gap-2"><CalendarClock size={20} /> 일정</h2>
				{#if !schedule}
					<p class="mt-2">예약 없음 — 직접 실행할 때만 실행합니다.</p>
				{:else}
					<dl class="kv mt-3">
						<dt>반복</dt>
						<dd>{describeRule(schedule.rule)}</dd>
						<dt>시간대</dt>
						<dd>{schedule.timezone}</dd>
						<dt>공휴일</dt>
						<dd>제외 규칙 없음</dd>
						<dt>상태</dt>
						<dd>{schedule.active && task.status === 'active' ? '예약 사용 중' : '일시중지 — 예약 실행 없음'}</dd>
					</dl>
					{#if data.detail.upcoming.length}
						<h3 class="mt-4 font-semibold">다음 3회</h3>
						<ol class="mt-1 list-decimal pl-6" data-testid="task-upcoming">
							{#each data.detail.upcoming as u (u)}<li>{fmtDateTime(u, schedule.timezone)} <span class="text-sm text-muted">{schedule.timezone}</span></li>{/each}
						</ol>
					{:else}
						<p class="hint mt-3">일시중지 중이라 예정된 실행이 없습니다. 재개하면 그 시점 이후 예약만 실행하며, 멈춘 동안 놓친 실행은 하지 않습니다.</p>
					{/if}
				{/if}
			</section>
		</div>

		<section class="card" aria-labelledby="mute-title">
			<h2 id="mute-title" class="section-title flex items-center gap-2"><BellOff size={20} /> 오늘 알림 끄기</h2>
			<p class="mt-1">
				“오늘은 알림 더 표시 안함”은 <strong>이 업무의 정상 결과 알림만</strong> 한국 시간 자정(00:00 KST)까지 숨깁니다. 오류·검토 필요 알림과 다른 업무의 알림은 그대로 받습니다. 자정이 지나면 자동으로 다시 켜집니다.
			</p>
			<div class="mt-3 flex flex-wrap items-center gap-3">
				<Button onclick={muteToday} disabled={muteBusy} data-testid="mute-today"><BellOff size={18} />오늘은 알림 더 표시 안함</Button>
				{#if muteUntil}
					<p class="font-semibold text-primary" role="status" data-testid="mute-result">{fmtDateTime(muteUntil, 'Asia/Seoul')} (KST)까지 이 업무의 정상 알림을 숨깁니다.</p>
				{/if}
			</div>
		</section>

		<section class="card" aria-labelledby="runs-title">
			<h2 id="runs-title" class="section-title">실행 기록</h2>
			{#if data.runs.length === 0}
				<p class="hint mt-2">아직 실행하지 않았습니다.</p>
			{:else}
				<div class="table-wrap mt-3" role="region" aria-labelledby="runs-title" tabindex="-1">
					<table class="data-table">
						<thead>
							<tr>
								<th scope="col">요청 시각</th>
								<th scope="col">방식</th>
								<th scope="col">상태</th>
								<th scope="col">회차</th>
								<th scope="col"><span class="sr-only">열기</span></th>
							</tr>
						</thead>
						<tbody>
							{#each data.runs as r (r.id)}
								<tr>
									<td class="whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
									<td>{TRIGGER_LABEL[r.trigger] ?? r.trigger}{#if r.late}<span class="ml-1 text-sm font-semibold text-warning">(지연)</span>{/if}</td>
									<td><StatusBadge state={r.state} /></td>
									<td>{r.round}차</td>
									<td><a href="/runs/{r.id}" class="inline-flex min-h-11 items-center font-semibold">자세히<span class="sr-only"> ({fmtDateTime(r.createdAt)} 실행)</span></a></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	</div>
</div>

<ConfirmDialog bind:open={archiveOpen} title="업무를 보관할까요?" confirmLabel="보관" tone="danger" onconfirm={() => setStatus('archived')}>
	<p>예약 실행이 멈추고 홈 목록에서 숨겨집니다. 지난 결과·다운로드·근거는 삭제하지 않습니다. 보관한 업무는 새로 실행할 수 없습니다.</p>
</ConfirmDialog>
