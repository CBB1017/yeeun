<script lang="ts">
	import { ArrowUpDown, ArrowUp, ArrowDown, Eye } from '@lucide/svelte';
	import type { ResultTable } from '#lib/client/types.ts';

	/**
	 * Result rows with the source's original headers, column order and values.
	 * Wide tables scroll inside their own container; the page never overflows.
	 * Sorting is optional; default is the source order.
	 */
	type Props = {
		table: ResultTable;
		caption: string;
		selectedId: string | null;
		onselect: (row: ResultTable['rows'][number], trigger: HTMLElement) => void;
		id: string;
	};
	let { table, caption, selectedId, onselect, id }: Props = $props();

	let sortCol = $state<string | null>(null);
	let sortDir = $state<'ascending' | 'descending'>('ascending');

	function cellText(row: ResultTable['rows'][number], col: string): string {
		const c = row.cells[col];
		if (!c) return '';
		return c.display ?? c.value ?? '';
	}

	const rows = $derived.by(() => {
		if (!sortCol) return table.rows;
		const col = sortCol;
		const dir = sortDir === 'ascending' ? 1 : -1;
		return [...table.rows].sort((a, b) => {
			const ca = a.cells[col];
			const cb = b.cells[col];
			if (ca?.type === 'number' && cb?.type === 'number' && ca.value && cb.value) return (Number(ca.value) - Number(cb.value)) * dir;
			const va = ca?.value ?? ca?.display ?? '';
			const vb = cb?.value ?? cb?.display ?? '';
			return va.localeCompare(vb, 'ko') * dir;
		});
	});

	function toggleSort(col: string) {
		if (sortCol !== col) {
			sortCol = col;
			sortDir = 'ascending';
		} else if (sortDir === 'ascending') sortDir = 'descending';
		else sortCol = null;
	}
	const rowNumber = (rid: string) => table.rows.findIndex((r) => r.record_id === rid) + 1;
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (scrollable region must be keyboard-scrollable) -->
<div class="table-wrap" role="region" aria-labelledby="{id}-caption" tabindex="0" data-testid="records-table-wrap">
	<table class="data-table" data-testid="records-table">
		<caption id="{id}-caption" class="px-3 py-2 text-left font-semibold">{caption}</caption>
		<thead>
			<tr>
				<th scope="col" class="w-0"><span class="sr-only">상세·근거</span></th>
				{#each table.columns as c (c.column_id)}
					<th scope="col" aria-sort={sortCol === c.column_id ? sortDir : 'none'}>
						<button type="button" class="-mx-1 inline-flex min-h-11 items-center gap-1 rounded px-1 font-semibold" onclick={() => toggleSort(c.column_id)} aria-label="{c.label} 기준 정렬">
							<span>{c.label}</span>
							{#if sortCol === c.column_id}
								{#if sortDir === 'ascending'}<ArrowUp size={14} />{:else}<ArrowDown size={14} />{/if}
							{:else}
								<ArrowUpDown size={14} class="text-muted" />
							{/if}
						</button>
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as r (r.record_id)}
				<tr class={selectedId === r.record_id ? 'bg-primary-soft' : ''}>
					<td class="py-1">
						<button
							type="button"
							class="inline-flex min-h-11 items-center gap-1 rounded-[8px] px-2 font-semibold whitespace-nowrap text-primary hover:bg-primary-soft"
							onclick={(e) => onselect(r, e.currentTarget)}
							aria-label="상세 — {rowNumber(r.record_id)}번째 행의 모든 값과 근거"
							data-testid="row-evidence"
						>
							<Eye size={16} />상세
						</button>
					</td>
					{#each table.columns as c (c.column_id)}
						<td class={['date', 'number', 'boolean'].includes(r.cells[c.column_id]?.type ?? '') ? 'whitespace-nowrap' : 'max-w-[22rem] min-w-[10rem] whitespace-pre-wrap'}>{cellText(r, c.column_id)}</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>
{#if sortCol}
	<p class="hint mt-1">정렬해서 보는 중입니다. <button type="button" class="font-semibold text-primary underline" onclick={() => (sortCol = null)}>원본 순서로 보기</button></p>
{/if}
