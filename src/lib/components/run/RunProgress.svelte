<script lang="ts">
	import { CircleCheck, CircleX, LoaderCircle, Circle } from '@lucide/svelte';
	import type { PublicRun, RunEvent } from '#lib/client/types.ts';
	import { PROVIDER_LABEL, fmtDateTime } from '#lib/client/format.ts';

	/**
	 * Real backend stages only (no percentages or estimated progress):
	 * queued -> preparing -> executing (each CLI) -> comparing -> finalizing.
	 */
	type Props = { run: PublicRun; events: RunEvent[] };
	let { run, events }: Props = $props();

	const ORDER = ['queued', 'preparing', 'executing', 'comparing', 'finalizing', 'done'] as const;
	type Step = (typeof ORDER)[number];
	const LABEL: Record<Step, string> = { queued: '대기열', preparing: '원본 확보', executing: '두 CLI 독립 분석', comparing: '결과 비교', finalizing: '결과 정리', done: '완료' };

	const current = $derived.by((): Step => {
		const s = run.state;
		if (s === 'queued') return 'queued';
		if (s === 'review_queued') return 'queued';
		if (s === 'preparing' || s === 'executing' || s === 'comparing' || s === 'finalizing') return s;
		if (s === 'completed') return 'done';
		// Terminal/failure: the stage where it stopped.
		const st = run.errorStage;
		if (st && (ORDER as readonly string[]).includes(st)) return st as Step;
		if (s === 'awaiting_review' || s === 'disagreed') return 'comparing';
		return 'queued';
	});
	const failed = $derived(['failed', 'interrupted', 'cancelled', 'disagreed', 'awaiting_review'].includes(run.state));
	const roundEvents = $derived.by(() => {
		// Events of the current round only (round 2 restarts at executing).
		let lastReview = -1;
		events.forEach((e, i) => {
			if (e.type === 'review_requested') lastReview = i;
		});
		return lastReview >= 0 && run.round === 2 ? events.slice(lastReview) : events;
	});

	function stepStatus(step: Step): 'done' | 'current' | 'pending' | 'stopped' {
		const ci = ORDER.indexOf(current);
		const si = ORDER.indexOf(step);
		if (run.state === 'completed') return 'done';
		if (si < ci) return 'done';
		if (si === ci) return failed ? 'stopped' : 'current';
		return 'pending';
	}

	function cli(provider: 'claude' | 'codex', role: 'analysis' | 'review') {
		let started: RunEvent | undefined;
		let finished: RunEvent | undefined;
		for (const e of roundEvents) {
			if (e.data?.provider !== provider || e.data?.role !== role) continue;
			if (e.type === 'cli_started') started = e;
			if (e.type === 'cli_finished') finished = e;
		}
		if (finished) return { text: finished.data.status === 'succeeded' ? '완료' : `실패 (${String(finished.data.error_code ?? finished.data.status)})`, ok: finished.data.status === 'succeeded', at: finished.at ?? finished.createdAt };
		if (started) return { text: '실행 중', ok: null, at: started.at ?? started.createdAt };
		return { text: '시작 전', ok: null, at: null };
	}
	const STATUS_TEXT = { done: '완료', current: '진행 중', pending: '대기', stopped: '여기서 멈춤' };
</script>

<ol class="space-y-3" aria-label="실행 단계 (서버 상태 기준)" data-testid="run-progress">
	{#each ORDER.filter((s) => s !== 'done') as step (step)}
		{@const st = stepStatus(step)}
		<li class="flex gap-3" aria-current={st === 'current' ? 'step' : undefined}>
			<span class="mt-0.5 flex-none {st === 'done' ? 'text-primary' : st === 'current' ? 'text-primary' : st === 'stopped' ? 'text-danger' : 'text-muted'}">
				{#if st === 'done'}<CircleCheck size={20} />{:else if st === 'current'}<LoaderCircle size={20} class="motion-safe:animate-spin" />{:else if st === 'stopped'}<CircleX size={20} />{:else}<Circle size={20} />{/if}
			</span>
			<div class="min-w-0">
				<p class="font-semibold">{LABEL[step]} <span class="text-sm font-normal text-muted">— {STATUS_TEXT[st]}</span></p>
				{#if step === 'executing' && (st !== 'pending' || run.round === 2)}
					<ul class="mt-1 space-y-0.5 text-sm">
						{#each ['claude', 'codex'] as const as p (p)}
							{@const c = cli(p, 'analysis')}
							<li>{PROVIDER_LABEL[p]}: <span class="font-semibold {c.ok === false ? 'text-danger' : ''}">{c.text}</span>{c.at ? ` · ${fmtDateTime(c.at)}` : ''}</li>
						{/each}
					</ul>
				{/if}
				{#if step === 'comparing' && st !== 'pending' && run.reviewer}
					{@const c = cli(run.reviewer, 'review')}
					<p class="mt-1 text-sm">코드 검산 후 담당 대조: {PROVIDER_LABEL[run.reviewer]} — <span class="font-semibold {c.ok === false ? 'text-danger' : ''}">{c.text}</span></p>
				{/if}
			</div>
		</li>
	{/each}
</ol>
