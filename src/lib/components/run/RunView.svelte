<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { Download, RotateCcw, Send, Ban, GitCompare, Eye, X, RefreshCw } from '@lucide/svelte';
	import Button from '../Button.svelte';
	import Notice from '../Notice.svelte';
	import Modal from '../Modal.svelte';
	import PageHeader from '../PageHeader.svelte';
	import StatusBadge from '../StatusBadge.svelte';
	import ConfirmDialog from '../ConfirmDialog.svelte';
	import RunProgress from './RunProgress.svelte';
	import RecordsTable from './RecordsTable.svelte';
	import Disagreement from './Disagreement.svelte';
	import EvidencePanel, { type EvidenceSelection } from './EvidencePanel.svelte';
	import { api, messageOf, newIdempotencyKey } from '#lib/client/api.ts';
	import { announce } from '#lib/client/live.svelte.ts';
	import { subscribeRunEvents } from '#lib/client/sse.ts';
	import {
		CHANNEL_LABEL,
		NOTIFICATION_EVENT,
		NOTIFICATION_STATUS,
		PROVIDER_LABEL,
		RETENTION_LABEL,
		STAGE_LABEL,
		TRIGGER_LABEL,
		errorInfo,
		fmtBytes,
		fmtDate,
		fmtDateTime,
		stateInfo,
		FORMAT_LABEL
	} from '#lib/client/format.ts';
	import type { Claim, ExternalAction, PublicRun, ResultTable, RunDetail, RunEvent, RunEvidence, RunResult } from '#lib/client/types.ts';

	type Props = { detail: RunDetail; result: RunResult | null; evidence: RunEvidence | null };
	let { detail: d0, result: r0, evidence: e0 }: Props = $props();

	let detail = $state<RunDetail>(untrack(() => d0));
	let result = $state<RunResult | null>(untrack(() => r0));
	let evidence = $state<RunEvidence | null>(untrack(() => e0));
	let events = $state<RunEvent[]>(untrack(() => d0.events));
	let connection = $state<'open' | 'reconnecting' | 'idle'>('idle');

	const run = $derived(detail.run);
	const info = $derived(stateInfo(run.state));
	const terminal = $derived(['completed', 'disagreed', 'failed', 'cancelled', 'interrupted'].includes(run.state));
	const cancellable = $derived(!terminal && !run.cancelRequested);
	const version = $derived(result?.version ?? run.version);
	const lastComparison = $derived(detail.comparisons.at(-1) ?? null);
	const finalChecks = $derived(detail.comparisons.find((c) => c.verdict === 'agree')?.checks ?? lastComparison?.checks ?? null);
	const showDisagreement = $derived(['awaiting_review', 'review_queued', 'disagreed'].includes(run.state) || (['cancelled', 'failed'].includes(run.state) && detail.comparisons.some((c) => c.verdict === 'disagree')));
	const formulaChecks = $derived((result?.artifacts ?? []).flatMap((a) => (a.validation.checks ?? []).filter((c) => /수식 실행 방지|작은따옴표|제어문자/.test(c)).map((c) => `${a.filename}: ${c}`)));

	// ---------- evidence panel ----------
	let selection = $state<EvidenceSelection | null>(null);
	let isXl = $state(false);
	let sheetOpen = $state(false);
	let trigger: HTMLElement | null = null;
	let asideHeading = $state<HTMLElement | null>(null);

	function select(sel: EvidenceSelection, el: HTMLElement) {
		trigger = el;
		selection = sel;
		if (isXl) {
			void tick().then(() => asideHeading?.focus());
		} else {
			sheetOpen = true;
		}
	}
	function closeAside() {
		selection = null;
		trigger?.focus();
	}
	function selectRecord(table: ResultTable, row: ResultTable['rows'][number], el: HTMLElement) {
		const n = table.rows.findIndex((r) => r.record_id === row.record_id) + 1;
		select({ kind: 'record', table, row, label: `작업 ${table.operation_index + 1} 결과 ${n}번째 행` }, el);
	}
	function selectClaim(claim: Claim, label: string, el: HTMLElement) {
		select({ kind: 'claim', claim, label }, el);
	}

	// ---------- live updates ----------
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;
	async function refresh() {
		try {
			const d = await api<RunDetail>(`/api/runs/${run.id}`);
			detail = d;
			events = mergeEvents(events, d.events);
			if (d.run.state === 'completed' && !result) result = await api<RunResult>(`/api/runs/${run.id}/result`).catch(() => null);
			if (['completed', 'awaiting_review', 'disagreed', 'failed', 'interrupted', 'cancelled'].includes(d.run.state)) {
				evidence = await api<RunEvidence>(`/api/runs/${run.id}/evidence`).catch(() => evidence);
			}
		} catch {
			/* keep showing the last known state; SSE keeps retrying */
		}
	}
	function mergeEvents(a: RunEvent[], b: RunEvent[]) {
		const m = new Map<number, RunEvent>();
		for (const e of [...a, ...b]) m.set(e.seq, e);
		return [...m.values()].sort((x, y) => x.seq - y.seq);
	}
	function describeEvent(e: RunEvent): string {
		if (e.type.startsWith('state:')) return `상태: ${stateInfo(e.type.slice(6)).label}`;
		const p = e.data?.provider ? PROVIDER_LABEL[String(e.data.provider)] : '';
		const role = e.data?.role === 'review' ? '대조' : '분석';
		switch (e.type) {
			case 'queued':
				return '대기열에 추가됨';
			case 'claimed':
				return '작업자가 실행을 시작함';
			case 'sources_captured':
				return `원본 ${e.data?.files ?? ''}개 확보 (hash 고정)`;
			case 'cli_started':
				return `${p} ${role} 시작`;
			case 'cli_finished':
				return `${p} ${role} ${e.data?.status === 'succeeded' ? '완료' : '실패'}`;
			case 'review_requested':
				return '재검토 요청됨 (2차, 같은 원본)';
			case 'cancel_requested':
				return '취소 요청됨';
			case 'cancelled':
				return '취소됨';
			default:
				return e.type;
		}
	}

	onMount(() => {
		const mq = window.matchMedia('(min-width: 1280px)');
		const sync = () => {
			isXl = mq.matches;
			if (isXl) sheetOpen = false;
		};
		sync();
		mq.addEventListener('change', sync);
		let stop: (() => void) | undefined;
		if (!terminal || run.state === 'awaiting_review') {
			const cursor = events.reduce((m, e) => Math.max(m, e.seq), 0);
			stop = subscribeRunEvents(
				run.id,
				cursor,
				(e) => {
					events = mergeEvents(events, [e]);
					announce(describeEvent(e));
					if (refreshTimer) clearTimeout(refreshTimer);
					refreshTimer = setTimeout(refresh, 250);
				},
				(s) => (connection = s)
			);
		}
		return () => {
			mq.removeEventListener('change', sync);
			stop?.();
			if (refreshTimer) clearTimeout(refreshTimer);
		};
	});

	// ---------- actions ----------
	let cancelOpen = $state(false);
	let rerunOpen = $state(false);
	let reviewBusy = $state(false);
	let actionMsg = $state<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null);
	let approveTarget = $state<ExternalAction | null>(null);
	let approveOpen = $state(false);

	async function cancelRun() {
		const r = await api<PublicRun>(`/api/runs/${run.id}/cancel`, { method: 'POST' });
		detail.run = r;
		const t = r.state === 'cancelled' ? '실행을 취소했습니다. 보관된 원본과 부분 결과는 삭제하지 않습니다.' : '취소를 요청했습니다. 진행 중인 단계가 멈추는 대로 취소됩니다.';
		actionMsg = { tone: 'info', text: t };
		announce(t);
		await refresh();
	}

	async function requestReview() {
		if (reviewBusy) return;
		reviewBusy = true;
		actionMsg = null;
		try {
			const r = await api<{ run: PublicRun; duplicate: boolean }>(`/api/runs/${run.id}/review`, { method: 'POST' });
			detail.run = r.run;
			const t = r.duplicate ? '이미 재검토를 요청했습니다. 중복 요청은 추가하지 않았습니다.' : '재검토(2차)를 요청했습니다. 최초에 확보한 같은 원본으로 한 번만 다시 검토합니다.';
			actionMsg = { tone: 'success', text: t };
			announce(t);
			await refresh();
		} catch (e) {
			actionMsg = { tone: 'danger', text: messageOf(e) };
		} finally {
			reviewBusy = false;
		}
	}

	async function newRun() {
		const r = await api<{ run: PublicRun }>(`/api/tasks/${run.taskId}/runs`, { method: 'POST', idempotencyKey: newIdempotencyKey('rerun') });
		await goto(`/runs/${r.run.id}`);
	}

	async function approve() {
		if (!approveTarget) return;
		await api(`/api/external-actions/${approveTarget.id}/approve`, { method: 'POST', body: { approvalHash: approveTarget.approvalHash } });
		announce('전송을 승인했습니다');
		result = await api<RunResult>(`/api/runs/${run.id}/result`);
	}
	async function reject(a: ExternalAction) {
		try {
			await api(`/api/external-actions/${a.id}/reject`, { method: 'POST' });
			announce('전송 요청을 거부했습니다');
			result = await api<RunResult>(`/api/runs/${run.id}/result`);
		} catch (e) {
			actionMsg = { tone: 'danger', text: messageOf(e) };
		}
	}

	let resendBusy = $state<string | null>(null);
	async function resend(id: string) {
		resendBusy = id;
		try {
			await api(`/api/notifications/${id}/resend`, { method: 'POST' });
			announce('알림을 다시 보내도록 요청했습니다');
			await refresh();
		} catch (e) {
			actionMsg = { tone: 'danger', text: messageOf(e) };
		} finally {
			resendBusy = null;
		}
	}

	let muteMsg = $state('');
	async function muteToday() {
		try {
			const r = await api<{ muteUntil: string }>(`/api/tasks/${run.taskId}/mute-today`, { method: 'POST' });
			muteMsg = `${fmtDateTime(r.muteUntil, 'Asia/Seoul')} (KST)까지 이 업무의 정상 알림을 숨깁니다. 오류·검토 알림과 다른 업무 알림은 계속 받습니다.`;
			announce(muteMsg);
		} catch (e) {
			muteMsg = messageOf(e);
		}
	}

	const ACTION_STATUS: Record<string, string> = {
		pending: '승인 대기',
		approved: '승인됨 — 전송 대기',
		executing: '전송 중',
		executed: '전송 완료',
		rejected: '거부됨',
		failed: '전송 실패',
		invalidated: '파일 또는 대상이 바뀌어 무효 — 다시 확인 필요'
	};
	function artifactName(id: string) {
		return result?.artifacts.find((a) => a.id === id)?.filename ?? '결과 파일';
	}
</script>

<div class="xl:grid xl:grid-cols-[minmax(0,1fr)_24rem] xl:gap-6">
	<div class="min-w-0">
		<PageHeader title={detail.task?.title ?? '실행'} back={{ href: `/tasks/${run.taskId}`, label: '업무로 돌아가기' }}>
			{#snippet meta()}
				<StatusBadge state={run.state} />
				<span class="text-sm text-muted">{TRIGGER_LABEL[run.trigger] ?? run.trigger} · {run.round}차 · 요청 {fmtDateTime(run.createdAt)}</span>
				{#if run.late || run.trigger === 'catch_up'}
					<StatusBadge tone="warning" label={run.trigger === 'catch_up' ? '밀린 예약 실행' : '지연 실행'} />
				{/if}
			{/snippet}
			{#snippet actions()}
				{#if cancellable}
					<Button variant="danger-outline" onclick={() => (cancelOpen = true)} data-testid="cancel-run"><Ban size={18} />실행 취소</Button>
				{/if}
			{/snippet}
		</PageHeader>

		<div class="space-y-5">
			{#if actionMsg}
				<Notice tone={actionMsg.tone} role={actionMsg.tone === 'danger' ? 'alert' : 'status'} testid="action-message"><p>{actionMsg.text}</p></Notice>
			{/if}

			<!-- Status -->
			<section class="card" aria-labelledby="status-title" data-testid="run-status">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h2 id="status-title" class="section-title">상태: {info.label}</h2>
					{#if !terminal}
						<span class="text-sm text-muted">{connection === 'open' ? '실시간 연결됨' : connection === 'reconnecting' ? '연결 재시도 중 (실행은 계속됨)' : '연결 중'}</span>
					{/if}
				</div>
				<p class="mt-1">{info.description}</p>
				{#if run.cancelRequested && !terminal}
					<Notice tone="warning" class="mt-3"><p>취소를 요청했습니다. 진행 중인 단계가 멈추는 대로 취소됩니다.</p></Notice>
				{/if}
				{#if detail.waiting}
					<Notice tone={detail.waiting.kind === 'lane_review' ? 'warning' : 'info'} class="mt-3" title="기다리는 이유" testid="waiting-reason">
						<p>{detail.waiting.message}</p>
						{#if detail.waiting.kind === 'lane_review'}
							<p>같은 사용자의 실행은 한 줄로 차례대로 처리됩니다. 다른 사용자의 실행은 이 대기와 상관없이 진행됩니다.</p>
						{/if}
						{#snippet actions()}
							{#if detail.waiting?.blockingRunId}
								<Button href="/runs/{detail.waiting.blockingRunId}" variant="primary" data-testid="open-blocking-run">{detail.waiting.kind === 'lane_review' ? '검토 열기' : '앞선 실행 보기'}</Button>
							{/if}
							{#if cancellable}
								<Button variant="danger-outline" onclick={() => (cancelOpen = true)}>이 실행 취소</Button>
							{/if}
						{/snippet}
					</Notice>
				{/if}
				{#if !['completed'].includes(run.state)}
					<div class="mt-4"><RunProgress {run} {events} /></div>
				{/if}
			</section>

			<!-- Disagreement / review -->
			{#if showDisagreement && lastComparison}
				<section class="card" aria-labelledby="dis-title">
					<h2 id="dis-title" class="section-title flex items-center gap-2"><GitCompare size={20} /> 결과 불일치</h2>
					{#if run.state === 'awaiting_review' && run.round === 1}
						<Notice tone="warning" class="mt-3" title="검토가 필요합니다" testid="review-needed">
							<p>두 CLI의 결과가 일치하지 않아 결과를 확정하지 않았습니다. 재검토를 요청하면 <strong>최초에 확보한 같은 원본(hash 고정)</strong>으로 두 CLI가 차이에 대한 사실 피드백만 받아 다시 분석합니다. 재검토는 한 번만 가능합니다.</p>
							<p>원본을 다시 가져와 처음부터 하려면 재검토 대신 업무 화면에서 새로 실행하세요 — 새 원본·새 실행으로 처리됩니다.</p>
							{#snippet actions()}
								<Button variant="primary" onclick={requestReview} disabled={reviewBusy || run.reviewRequested} aria-busy={reviewBusy} data-testid="request-review"><RefreshCw size={18} />{reviewBusy ? '요청 중…' : '재검토 요청'}</Button>
								<Button variant="danger-outline" onclick={() => (cancelOpen = true)} data-testid="cancel-review">취소</Button>
							{/snippet}
						</Notice>
					{:else if run.state === 'review_queued'}
						<Notice tone="info" class="mt-3" title="재검토 요청됨" testid="review-requested"><p>2차 검토를 기다리고 있습니다. 같은 원본으로 한 번만 진행합니다.</p></Notice>
					{:else if run.state === 'disagreed'}
						<Notice tone="danger" class="mt-3" title="재검토 후에도 일치하지 않음 — 미해결" testid="disagreed">
							<p>2차 검토까지 마쳤지만 결과가 일치하지 않아 확정하지 않았습니다. 더 이상 자동으로 검토하지 않습니다. 두 결과와 차이, 근거를 확인하세요. 원본과 부분 결과는 보관되어 있습니다.</p>
							{#snippet actions()}
								<Button onclick={() => (rerunOpen = true)}><RotateCcw size={18} />새로 실행</Button>
							{/snippet}
						</Notice>
					{/if}
					<div class="mt-4 space-y-6">
						{#each [...detail.comparisons].reverse() as c (c.id)}
							{#if c.verdict === 'disagree'}
								<Disagreement comparison={c} executions={detail.executions} onclaim={selectClaim} />
							{/if}
						{/each}
					</div>
				</section>
			{/if}

			<!-- Error -->
			{#if ['failed', 'interrupted', 'cancelled'].includes(run.state)}
				{@const ei = errorInfo(run.errorCode)}
				<section class="card" aria-labelledby="err-title" data-testid="error-view">
					<h2 id="err-title" class="section-title">{run.state === 'cancelled' ? '취소된 실행' : '실행 오류'}</h2>
					<dl class="kv mt-3">
						<dt>오류 코드</dt>
						<dd class="mono">{run.errorCode ?? '—'}</dd>
						<dt>내용</dt>
						<dd>{ei.title}{run.errorMessage && run.errorMessage !== ei.title ? ` — ${run.errorMessage}` : ''}</dd>
						<dt>멈춘 단계</dt>
						<dd>{STAGE_LABEL[run.errorStage ?? ''] ?? run.errorStage ?? '—'}</dd>
						<dt>재시도</dt>
						<dd class="font-semibold">자동 재시도하지 않음</dd>
						<dt>보관 상태</dt>
						<dd>{RETENTION_LABEL[run.retentionStatus] ?? run.retentionStatus}</dd>
					</dl>
					{#if detail.retained.length}
						<p class="mt-3 text-sm font-semibold">보관된 자료</p>
						<ul class="text-sm">
							{#each detail.retained as rc (rc.id)}
								<li>{rc.kind === 'partial' ? '부분 결과' : rc.kind === 'result' ? '결과' : rc.kind} · SHA-256 <span class="mono">{rc.sha256.slice(0, 16)}…</span> · {fmtDateTime(rc.createdAt)}</li>
							{/each}
						</ul>
					{/if}
					<p class="mt-3">{ei.action}</p>
					<div class="mt-3">
						<Button variant="primary" onclick={() => (rerunOpen = true)} data-testid="rerun"><RotateCcw size={18} />새로 실행</Button>
					</div>
				</section>
			{/if}

			<!-- Result -->
			{#if run.state === 'completed' && result}
				{@const a = result.answer}
				<section class="card" aria-labelledby="sum-title" data-testid="result-summary">
					<h2 id="sum-title" class="section-title">결과</h2>
					{#if a.zero_result}
						<Notice tone="info" class="mt-3" title="조건에 맞는 항목이 0건입니다" testid="zero-result">
							<p>이번 실행에서 해당하는 행이 없었습니다. 오늘 이 업무의 정상 알림을 더 받지 않으려면 아래 버튼을 누르세요 (오류·검토 알림과 다른 업무 알림은 계속 받습니다. 00:00 KST에 다시 켜짐).</p>
							{#snippet actions()}
								<Button onclick={muteToday} data-testid="mute-today">오늘은 알림 더 표시 안함</Button>
							{/snippet}
						</Notice>
						{#if muteMsg}<p class="mt-2 font-semibold text-primary" role="status">{muteMsg}</p>{/if}
					{/if}
					{#if a.summary}<p class="mt-3 break-words whitespace-pre-wrap">{a.summary}</p>{/if}
					<p class="mt-2 text-sm text-muted">기준일 {fmtDate(a.reference_date)} · 결과 {result.recordCount}건 · 담당 대조 {a.reviewer ? PROVIDER_LABEL[a.reviewer] : '—'} · {a.round}차에서 일치</p>

					{#if a.claims.length}
						<h3 class="mt-4 font-semibold">주요 값</h3>
						<ul class="mt-1 divide-y divide-line-soft" data-testid="claims">
							{#each a.claims as c (c.claim_key)}
								<li class="flex flex-wrap items-center justify-between gap-2 py-1">
									<span class="min-w-0"><span class="mono text-muted">{c.claim_key}</span> <span class="font-semibold">{c.value.value}{c.unit ? ` ${c.unit}` : ''}</span></span>
									<button
										type="button"
										class="inline-flex min-h-11 flex-none items-center gap-1 rounded-[8px] px-2 font-semibold whitespace-nowrap text-primary hover:bg-primary-soft"
										onclick={(e) => selectClaim(c, `주요 값 · ${c.claim_key}`, e.currentTarget)}
										aria-label="{c.claim_key} 근거 보기"
										data-testid="claim-evidence"
									>
										<Eye size={16} />근거
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				{#each a.tables as t, ti (ti)}
					<section class="card" aria-label="작업 {t.operation_index + 1} 결과 표">
						<RecordsTable
							table={t}
							id="tbl-{ti}"
							caption="작업 {t.operation_index + 1} 결과 {t.rows.length}건{t.window?.from ? ` · 기간 ${t.window.from} ~ ${t.window.to}` : ''} — 원본 머리글·열 순서 그대로"
							selectedId={selection?.kind === 'record' ? selection.row.record_id : null}
							onselect={(row, el) => selectRecord(t, row, el)}
						/>
						{#if t.rows.length === 0}
							<p class="mt-2" role="status">해당하는 행이 없습니다 (0건).</p>
						{/if}
					</section>
				{/each}

				{#if a.warnings.length || formulaChecks.length || a.uncertainties.length}
					<section class="card space-y-3" aria-labelledby="warn-title">
						<h2 id="warn-title" class="section-title">주의할 점</h2>
						{#if a.warnings.length || formulaChecks.length}
							<div>
								<h3 class="font-semibold">경고</h3>
								<ul class="mt-1 list-disc space-y-1 pl-5" data-testid="warnings">
									{#each [...a.warnings, ...formulaChecks] as w, wi (wi)}<li class="break-words">{w}</li>{/each}
								</ul>
							</div>
						{/if}
						{#if a.uncertainties.length}
							<div>
								<h3 class="font-semibold">불확실한 점</h3>
								<ul class="mt-1 list-disc space-y-1 pl-5">
									{#each a.uncertainties as u, ui (ui)}<li class="break-words">{u}</li>{/each}
								</ul>
							</div>
						{/if}
					</section>
				{/if}

				<section class="card" aria-labelledby="dl-title">
					<h2 id="dl-title" class="section-title flex items-center gap-2"><Download size={20} /> 다운로드</h2>
					{#if result.artifacts.length === 0}
						<p class="hint mt-2">요청한 다운로드 파일이 없습니다. 결과는 이 화면에서 볼 수 있습니다.</p>
					{:else}
						<p class="hint mt-1">원본은 수정하지 않았습니다. 아래 파일은 새로 만든 복사본이며 다시 열어 검증했습니다.</p>
						<ul class="mt-3 space-y-4" data-testid="artifacts">
							{#each result.artifacts as art (art.id)}
								<li class="rounded-[8px] border border-line-soft p-3">
									<div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
										<div class="min-w-0">
											<p class="font-semibold break-words">{art.filename}</p>
											<p class="text-sm text-muted">{FORMAT_LABEL[art.format] ?? art.format} · {fmtBytes(art.sizeBytes)} · {art.validation.reopened ? '다시 열어 검증함' : '검증 정보 없음'}</p>
											<p class="text-sm break-all">SHA-256 <span class="mono">{art.sha256}</span></p>
										</div>
										<Button variant="primary" href="/api/artifacts/{art.id}/download" download={art.filename} class="flex-none whitespace-nowrap" aria-label="{art.filename} 다운로드" data-testid="download-{art.format}"><Download size={18} />다운로드</Button>
									</div>
									{#if art.validation.has_preview}
										<img src="/api/artifacts/{art.id}/preview" alt="{art.filename} 첫 페이지 미리보기" class="mt-3 max-h-80 w-auto max-w-full rounded-[8px] border border-line-soft" loading="lazy" />
									{/if}
									{#if art.validation.checks?.length}
										<details class="mt-2">
											<summary class="min-h-11 py-2 font-semibold">검증 내역 {art.validation.checks.length}개</summary>
											<ul class="list-disc space-y-0.5 pl-5 text-sm">
												{#each art.validation.checks as c, ci (ci)}<li class="break-words">{c}</li>{/each}
											</ul>
										</details>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				{#if result.externalActions.length}
					<section class="card" aria-labelledby="ext-title">
						<h2 id="ext-title" class="section-title flex items-center gap-2"><Send size={20} /> 외부 전송</h2>
						<p class="hint mt-1">아래 대상·파일 hash를 확인하고 승인해야만 한 번 전송합니다. 파일이나 대상이 바뀌면 다시 승인해야 합니다.</p>
						<ul class="mt-3 space-y-3">
							{#each result.externalActions as x (x.id)}
								<li class="rounded-[8px] border border-line-soft p-3" data-testid="external-action">
									<dl class="kv text-[0.9375rem]">
										<dt>동작</dt>
										<dd>{x.action === 'drive_upload_copy' ? 'Google Drive에 복사본 올리기' : x.action}</dd>
										<dt>대상</dt>
										<dd class="break-words">{x.destination.label ?? JSON.stringify(x.destination)}</dd>
										<dt>파일</dt>
										<dd class="break-words">{artifactName(x.artifactId)}</dd>
										<dt>파일 SHA-256</dt>
										<dd class="mono">{x.artifactSha256}</dd>
										<dt>상태</dt>
										<dd class="font-semibold">{ACTION_STATUS[x.status] ?? x.status}{x.lastError ? ` — ${x.lastError}` : ''}</dd>
									</dl>
									{#if x.status === 'pending'}
										<div class="mt-3 flex flex-wrap gap-2">
											<Button variant="primary" onclick={() => ((approveTarget = x), (approveOpen = true))}>승인하고 전송</Button>
											<Button variant="danger-outline" onclick={() => reject(x)} data-testid="reject-action">거부</Button>
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					</section>
				{/if}
			{/if}

			<!-- Analysed version -->
			{#if version}
				<section class="card" aria-labelledby="ver-title" data-testid="version-info">
					<h2 id="ver-title" class="section-title">분석한 원본 버전</h2>
					<ul class="mt-3 space-y-4">
						{#each version.files as f (f.snapshot_id)}
							{@const snap = detail.snapshots.find((s) => s.id === f.snapshot_id)}
							<li>
								<p class="font-semibold break-words">{f.name}</p>
								<dl class="kv mt-1 text-[0.9375rem]">
									{#if f.provider_revision}
										<dt>Drive 리비전</dt>
										<dd class="mono">{f.provider_revision}</dd>
									{:else}
										<dt>로컬 스냅샷 SHA-256</dt>
										<dd><span class="mono">{f.sha256}</span><span class="hint block">Drive가 리비전을 주지 않아 앱이 확보한 바이트의 해시로 버전을 식별합니다.</span></dd>
									{/if}
									{#if f.provider_revision}
										<dt>스냅샷 SHA-256</dt>
										<dd class="mono">{f.sha256}</dd>
									{/if}
									<dt>확보 시각</dt>
									<dd>{fmtDateTime(f.captured_at)}</dd>
									<dt>Drive 수정 시각</dt>
									<dd>{fmtDateTime(f.provider_modified_at)} <span class="hint">(참고용)</span></dd>
									{#if f.tables.length}
										<dt>읽은 표</dt>
										<dd>{f.tables.map((t) => `${t.label} (${t.rows}행 × ${t.columns}열)`).join(', ')}</dd>
									{/if}
									<dt>원본 스냅샷</dt>
									<dd>{snap?.status === 'deleted' ? '원본 스냅샷 정리됨; 분석 당시 근거 보관' : snap?.status === 'deletion_pending' ? '정리 예정 (근거는 보관)' : '보관 중'}</dd>
								</dl>
								{#if f.warnings.length}
									<ul class="mt-1 list-disc pl-5 text-sm">{#each f.warnings as w, wi (wi)}<li>{w}</li>{/each}</ul>
								{/if}
							</li>
						{/each}
					</ul>
					<dl class="kv mt-4 border-t border-line-soft pt-3 text-[0.9375rem]">
						<dt>전체 원본 hash</dt>
						<dd class="mono">{version.manifest_hash}</dd>
						<dt>담당 대조</dt>
						<dd>{run.reviewer ? PROVIDER_LABEL[run.reviewer] : '—'} (사용자별 순서 교대)</dd>
						{#if finalChecks?.expected.length}
							<dt>코드 검산</dt>
							<dd>
								<ul>
									{#each finalChecks.expected as x (x.index)}
										<li>작업 {x.index + 1} ({x.type === 'filter_rows' ? '행 찾기' : x.type === 'aggregate' ? '집계' : x.type}): {x.count !== null ? `${x.count}건` : (x.value ?? '—')}</li>
									{/each}
								</ul>
							</dd>
						{/if}
					</dl>
				</section>
			{/if}

			<!-- Notifications -->
			{#if detail.notifications.length}
				<section class="card" aria-labelledby="noti-title">
					<h2 id="noti-title" class="section-title">알림 전송 상태</h2>
					<ul class="mt-2 divide-y divide-line-soft" data-testid="run-notifications">
						{#each detail.notifications as n (n.id)}
							{@const st = NOTIFICATION_STATUS[n.status]}
							<li class="flex flex-wrap items-center justify-between gap-2 py-2">
								<div class="min-w-0">
									<p>{NOTIFICATION_EVENT[n.event] ?? n.event} · {CHANNEL_LABEL[n.channel]}</p>
									{#if n.lastError}<p class="text-sm break-words text-muted">{n.lastError}</p>{/if}
								</div>
								<div class="flex items-center gap-2">
									<StatusBadge tone={st?.tone ?? 'neutral'} label={st?.label ?? n.status} />
									{#if n.status === 'delivery_failed'}
										<Button size="sm" onclick={() => resend(n.id)} disabled={resendBusy === n.id} aria-label="{CHANNEL_LABEL[n.channel]} 알림 다시 보내기">다시 보내기</Button>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<details class="card">
				<summary class="min-h-11 py-2 font-semibold">실행 기록 ({events.length})</summary>
				<ol class="mt-2 space-y-1 text-sm">
					{#each events as e (e.seq)}
						<li><span class="text-muted">{fmtDateTime(e.at ?? e.createdAt)}</span> · {describeEvent(e)}</li>
					{/each}
				</ol>
			</details>
		</div>
	</div>

	<!-- Desktop evidence column -->
	{#if isXl}
		<aside class="min-w-0" aria-labelledby="evidence-aside-title" data-testid="evidence-aside">
			<div class="card sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
				<div class="flex items-center justify-between gap-2">
					<h2 id="evidence-aside-title" class="section-title" tabindex="-1" bind:this={asideHeading}>근거</h2>
					{#if selection}
						<button type="button" class="inline-flex size-11 items-center justify-center rounded-[8px] text-muted hover:bg-subtle hover:text-ink" aria-label="근거 닫기" onclick={closeAside} data-testid="evidence-close">
							<X size={20} />
						</button>
					{/if}
				</div>
				{#if evidence?.note}<p class="hint mt-1">{evidence.note}</p>{/if}
				<div class="mt-3"><EvidencePanel {selection} {evidence} /></div>
			</div>
		</aside>
	{/if}
</div>

{#if !isXl}
	<Modal bind:open={sheetOpen} title="근거" description={evidence?.note} variant="sheet" testid="evidence-sheet" onclose={() => (selection = null)}>
		<EvidencePanel {selection} {evidence} />
	</Modal>
{/if}

<ConfirmDialog bind:open={cancelOpen} title="이 실행을 취소할까요?" confirmLabel="실행 취소" tone="danger" onconfirm={cancelRun} testid="confirm-cancel">
	<p>
		{#if run.state === 'awaiting_review'}
			재검토하지 않고 이 실행을 끝냅니다. 두 결과와 원본은 보관되며, 같은 사용자의 다음 실행이 진행됩니다.
		{:else if ['queued', 'review_queued'].includes(run.state)}
			대기 중인 실행을 취소합니다. 아직 원본을 가져오거나 분석하지 않았습니다.
		{:else}
			진행 중인 단계가 멈추는 대로 취소합니다. 이미 확보한 원본과 부분 결과는 삭제하지 않습니다.
		{/if}
	</p>
</ConfirmDialog>

<ConfirmDialog bind:open={rerunOpen} title="새로 실행할까요?" confirmLabel="새로 실행" onconfirm={newRun} testid="confirm-rerun">
	<p>이 실행을 다시 시도하는 것이 아니라 <strong>새 실행</strong>을 만듭니다. Drive에서 원본을 새로 가져오므로 결과가 이번과 다를 수 있습니다. 이 실행의 기록과 보관 자료는 그대로 남습니다.</p>
</ConfirmDialog>

<ConfirmDialog bind:open={approveOpen} title="외부 전송을 승인할까요?" confirmLabel="승인하고 전송" onconfirm={approve}>
	{#if approveTarget}
		<dl class="kv text-[0.9375rem]">
			<dt>대상</dt>
			<dd class="break-words">{approveTarget.destination.label ?? '—'}</dd>
			<dt>파일</dt>
			<dd class="break-words">{artifactName(approveTarget.artifactId)}</dd>
			<dt>파일 SHA-256</dt>
			<dd class="mono">{approveTarget.artifactSha256}</dd>
		</dl>
		<p class="mt-2">승인은 이 파일·대상에 한 번만 유효합니다.</p>
	{/if}
</ConfirmDialog>
