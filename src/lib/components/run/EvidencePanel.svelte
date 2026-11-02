<script lang="ts" module>
	import type { Claim, ResultTable } from '#lib/client/types.ts';

	export type EvidenceSelection =
		| { kind: 'claim'; claim: Claim; label: string }
		| { kind: 'record'; table: ResultTable; row: ResultTable['rows'][number]; label: string };
</script>

<script lang="ts">
	import { ExternalLink } from '@lucide/svelte';
	import type { RunEvidence, EvidenceRow, SnapshotInfo } from '#lib/client/types.ts';
	import { fmtDateTime } from '#lib/client/format.ts';

	type Props = { selection: EvidenceSelection | null; evidence: RunEvidence | null; headingId?: string };
	let { selection, evidence, headingId }: Props = $props();

	const LOC_LABEL: Record<string, string> = {
		file: '파일',
		table: '시트/표',
		sheet: '시트',
		row: '행',
		column: '열',
		cell: '셀',
		page: '페이지',
		slide: '슬라이드',
		notes: '노트',
		region: '영역',
		x: 'x',
		y: 'y',
		width: '너비',
		height: '높이',
		chart: '차트',
		series: '계열'
	};
	const KIND_LABEL: Record<string, string> = { cell: '셀', row: '행', page: '페이지', slide: '슬라이드', notes: '발표자 노트', region: '이미지 영역', chart: '차트' };

	const items = $derived.by((): { key: string; row: EvidenceRow | null }[] => {
		if (!selection || !evidence) return [];
		if (selection.kind === 'claim') return selection.claim.evidence_ids.map((k) => ({ key: k, row: evidence.evidence.find((e) => e.key === k) ?? null }));
		const rid = selection.row.record_id;
		return evidence.evidence
			.filter((e) => e.location.record_id === rid)
			.sort((a, b) => (a.kind === 'row' ? -1 : b.kind === 'row' ? 1 : a.key.localeCompare(b.key)))
			.map((e) => ({ key: e.key, row: e }));
	});

	function snap(id: string): SnapshotInfo | undefined {
		return evidence?.snapshots.find((s) => s.id === id);
	}

	function locEntries(loc: EvidenceRow['location']) {
		return Object.entries(loc).filter(([k, v]) => k !== 'record_id' && v !== null && v !== '');
	}

	/** Split an excerpt so the claimed value can be highlighted (text, not colour alone: <mark>). */
	function parts(text: string, needle: string | null): { t: string; hit: boolean }[] {
		if (!needle || needle.length < 1) return [{ t: text, hit: false }];
		const i = text.indexOf(needle);
		if (i < 0) return [{ t: text, hit: false }];
		return [
			{ t: text.slice(0, i), hit: false },
			{ t: needle, hit: true },
			{ t: text.slice(i + needle.length), hit: false }
		];
	}
	const needle = $derived(selection?.kind === 'claim' ? selection.claim.value.value : null);
</script>

{#if !selection}
	<p class="hint">결과 표의 “상세” 또는 주장 옆 “근거”를 누르면 원본 위치와 발췌가 여기에 표시됩니다.</p>
{:else}
	<div class="space-y-4" data-testid="evidence-content">
		<p id={headingId} class="font-semibold break-words">{selection.label}</p>

		{#if selection.kind === 'record'}
			{@const t = selection.table}
			{@const r = selection.row}
			<section aria-label="레코드 전체 값">
				<h3 class="mb-1 text-sm font-semibold text-muted">레코드 (모든 열)</h3>
				<dl class="kv rounded-[8px] border border-line-soft p-3 text-[0.9375rem]">
					{#each t.columns as c (c.column_id)}
						<dt>{c.label}</dt>
						<dd class="break-words whitespace-pre-wrap">{r.cells[c.column_id]?.display ?? r.cells[c.column_id]?.value ?? ''}</dd>
					{/each}
				</dl>
			</section>
		{:else}
			{@const c = selection.claim}
			<dl class="kv text-[0.9375rem]">
				<dt>항목</dt>
				<dd class="mono">{c.claim_key}</dd>
				<dt>값</dt>
				<dd class="font-semibold">{c.value.value}{c.unit ? ` ${c.unit}` : ''} <span class="text-sm font-normal text-muted">({c.value.type})</span></dd>
			</dl>
		{/if}

		<section aria-label="근거 위치">
			<h3 class="mb-1 text-sm font-semibold text-muted">근거 {items.length}개</h3>
			{#if !evidence}
				<p class="hint">근거를 불러오지 못했습니다.</p>
			{:else if items.length === 0}
				<p class="hint">이 항목에 연결된 근거가 없습니다.</p>
			{/if}
			<ol class="space-y-3">
				{#each items as it (it.key)}
					<li class="rounded-[8px] border border-line-soft p-3">
						{#if !it.row}
							<p class="text-sm">근거 <span class="mono">{it.key}</span>: 저장된 근거를 찾을 수 없습니다.</p>
						{:else}
							{@const e = it.row}
							{@const s = snap(e.snapshotId)}
							<p class="text-sm font-semibold">{KIND_LABEL[e.kind] ?? e.kind} 근거</p>
							<dl class="kv mt-1 text-sm">
								{#each locEntries(e.location) as [k, v] (k)}
									<dt>{LOC_LABEL[k] ?? k}</dt>
									<dd class="break-words">{v}</dd>
								{/each}
							</dl>
							<figure class="mt-2">
								<figcaption class="text-sm text-muted">분석 당시 발췌</figcaption>
								<blockquote class="mt-1 rounded-[8px] bg-subtle p-2 text-[0.9375rem] break-words whitespace-pre-wrap">
									{#each parts(e.excerpt, needle) as p, pi (pi)}{#if p.hit}<mark class="rounded bg-[#ccfbf1] px-0.5 font-semibold text-ink">{p.t}</mark>{:else}{p.t}{/if}{/each}
								</blockquote>
							</figure>
							{#if s}
								<div class="mt-2 space-y-1 text-sm">
									<p>
										{#if s.providerRevision}
											Drive 리비전 <span class="mono">{s.providerRevision}</span>
										{:else}
											로컬 스냅샷 SHA-256 <span class="mono">{s.sha256}</span>
										{/if}
									</p>
									<p>확보 시각 {fmtDateTime(s.capturedAt)}</p>
									{#if s.status === 'deleted'}
										<p class="font-semibold text-warning" data-testid="snapshot-deleted">원본 스냅샷 정리됨; 분석 당시 근거 보관</p>
									{/if}
									{#if s.driveLink}
										<a href={s.driveLink} target="_blank" rel="noopener noreferrer" class="inline-flex min-h-11 items-center gap-1 font-semibold">
											<ExternalLink size={16} />원본 Drive에서 열기<span class="sr-only"> (새 창)</span>
										</a>
										<p class="hint">현재 버전일 수 있음 — 분석 당시와 내용이 다를 수 있습니다.</p>
									{/if}
								</div>
							{/if}
						{/if}
					</li>
				{/each}
			</ol>
		</section>
	</div>
{/if}
