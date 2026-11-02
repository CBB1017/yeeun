<script lang="ts">
	import { Eye } from '@lucide/svelte';
	import type { AnalysisResult, Claim, Comparison, Execution } from '#lib/client/types.ts';
	import { PROVIDER_LABEL, fmtDateTime, errorInfo } from '#lib/client/format.ts';

	/** Both CLI results side by side + field differences + deterministic check failures. */
	type Props = {
		comparison: Comparison;
		executions: Execution[];
		onclaim: (claim: Claim, label: string, trigger: HTMLElement) => void;
	};
	let { comparison, executions, onclaim }: Props = $props();

	const sides = $derived(
		(['claude', 'codex'] as const).map((p) => {
			const ex = executions.find((e) => e.role === 'analysis' && e.round === comparison.round && e.provider === p);
			return { provider: p, ex, result: (ex?.result ?? null) as AnalysisResult | null };
		})
	);
	const review = $derived(executions.find((e) => e.role === 'review' && e.round === comparison.round));
	const STATUS = { ok: '정상 응답', unsupported: '지원하지 않는 요청이라고 응답', needs_input: '입력이 더 필요하다고 응답' };
</script>

<div class="space-y-5" data-testid="disagreement">
	<section aria-labelledby="sides-title-{comparison.round}">
		<h3 id="sides-title-{comparison.round}" class="font-semibold">{comparison.round}차: 두 CLI 결과 (같은 원본 hash로 각각 독립 실행)</h3>
		<div class="mt-2 grid gap-3 md:grid-cols-2">
			{#each sides as s (s.provider)}
				<article class="min-w-0 rounded-[8px] border border-line p-3" aria-labelledby="side-{comparison.round}-{s.provider}">
					<h4 id="side-{comparison.round}-{s.provider}" class="text-base font-bold">{PROVIDER_LABEL[s.provider]}</h4>
					{#if !s.ex}
						<p class="hint">실행 기록이 없습니다.</p>
					{:else if !s.result}
						<p class="text-sm"><span class="font-semibold text-danger">{s.ex.status === 'failed' ? '실패' : s.ex.status}</span>{s.ex.errorCode ? ` — ${errorInfo(s.ex.errorCode).title}` : ''}</p>
						{#if s.ex.errorMessage}<p class="hint mt-1 break-words">{s.ex.errorMessage}</p>{/if}
					{:else}
						{@const r = s.result}
						<p class="text-sm text-muted">{STATUS[r.status]} · {fmtDateTime(s.ex.finishedAt)}{s.ex.cliVersion ? ` · v${s.ex.cliVersion}` : ''}</p>
						<p class="mt-2 break-words whitespace-pre-wrap">{r.summary}</p>
						{#if r.claims.length}
							<div class="table-wrap mt-2">
								<table class="data-table">
									<caption class="sr-only">{PROVIDER_LABEL[s.provider]} 주장 값</caption>
									<thead><tr><th scope="col">항목</th><th scope="col">값</th><th scope="col"><span class="sr-only">근거</span></th></tr></thead>
									<tbody>
										{#each r.claims as c (c.claim_key)}
											<tr>
												<th scope="row" class="mono font-normal whitespace-nowrap [word-break:normal]">{c.claim_key}</th>
												<td class="font-semibold whitespace-nowrap">{c.value.value}{c.unit ? ` ${c.unit}` : ''}</td>
												<td class="py-1">
													<button
														type="button"
														class="inline-flex min-h-11 items-center gap-1 rounded-[8px] px-2 font-semibold whitespace-nowrap text-primary hover:bg-primary-soft"
														onclick={(e) => onclaim(c, `${PROVIDER_LABEL[s.provider]} · ${c.claim_key}`, e.currentTarget)}
														aria-label="{PROVIDER_LABEL[s.provider]}의 {c.claim_key} 근거 보기"
														data-testid="claim-evidence"
													>
														<Eye size={16} />근거
													</button>
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
						<p class="mt-2 text-sm">찾은 행 {r.records.length}개</p>
						{#if r.uncertainties.length}
							<p class="mt-2 text-sm font-semibold">불확실한 점</p>
							<ul class="list-disc pl-5 text-sm">{#each r.uncertainties as u, ui (ui)}<li>{u}</li>{/each}</ul>
						{/if}
					{/if}
				</article>
			{/each}
		</div>
	</section>

	{#if comparison.differences.length}
		<section aria-labelledby="diff-title-{comparison.round}">
			<h3 id="diff-title-{comparison.round}" class="font-semibold">항목별 차이 ({comparison.differences.length})</h3>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (scrollable region must be keyboard-scrollable) -->
			<div class="table-wrap mt-2" role="region" aria-labelledby="diff-title-{comparison.round}" tabindex="0">
				<table class="data-table" data-testid="differences-table">
					<thead>
						<tr><th scope="col">항목</th><th scope="col">Claude 값</th><th scope="col">Codex 값</th><th scope="col">차이 이유</th></tr>
					</thead>
					<tbody>
						{#each comparison.differences as d, di (di)}
							<tr>
								<th scope="row" class="mono font-normal whitespace-nowrap [word-break:normal]">{d.field}</th>
								<td class="whitespace-nowrap">{d.claude_value ?? '(없음)'}</td>
								<td class="whitespace-nowrap">{d.codex_value ?? '(없음)'}</td>
								<td class="min-w-[12rem]">{d.reason}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	{#if comparison.checks.failures.length}
		<section aria-labelledby="fail-title-{comparison.round}">
			<h3 id="fail-title-{comparison.round}" class="font-semibold">코드 검산 실패 ({comparison.checks.failures.length})</h3>
			<p class="hint">서버가 원본에서 직접 계산한 값과 맞지 않아 결과를 확정하지 않았습니다. 담당 CLI가 동의해도 확정하지 않습니다.</p>
			<ul class="mt-2 space-y-1">
				{#each comparison.checks.failures as f, fi (fi)}
					<li class="rounded-[8px] bg-danger-soft px-3 py-2 text-[0.9375rem]">
						<span class="font-semibold">{f.provider ? PROVIDER_LABEL[f.provider] : '공통'} · <span class="mono">{f.code}</span></span>
						<span class="block break-words">{f.detail}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<p class="text-sm text-muted">
		담당 대조: {comparison.reviewer ? `${PROVIDER_LABEL[comparison.reviewer]}${review ? ` (${review.status === 'succeeded' ? '응답함' : review.status})` : ''}` : '코드 검산 단계에서 불일치 — 담당 CLI 대조 전 중단'} · 원본 hash
		<span class="mono">{comparison.manifestHash.slice(0, 16)}</span>
	</p>
</div>
