<script lang="ts">
	import type { Predicate } from '#lib/client/types.ts';
	import { windowLabel } from '#lib/client/format.ts';

	type Props = { predicate: Predicate; id: string; legend: string; allowAll?: boolean };
	let { predicate = $bindable(), id, legend, allowAll = true }: Props = $props();

	const KINDS: { value: Predicate['kind']; label: string }[] = [
		{ value: 'all', label: '조건 없음 (모든 행)' },
		{ value: 'date_window', label: '날짜: 실행 시작일부터 N일' },
		{ value: 'date_between', label: '날짜: 시작~끝 날짜 사이' },
		{ value: 'equals', label: '값이 같음' },
		{ value: 'contains', label: '값에 글자 포함' },
		{ value: 'number_between', label: '숫자 범위' }
	];

	function setKind(kind: Predicate['kind']) {
		switch (kind) {
			case 'all':
				predicate = { kind: 'all' };
				break;
			case 'date_window':
				predicate = { kind: 'date_window', start: 'reference_date', days: 30 };
				break;
			case 'date_between':
				predicate = { kind: 'date_between', from: '', to: '' };
				break;
			case 'equals':
				predicate = { kind: 'equals', value: '' };
				break;
			case 'contains':
				predicate = { kind: 'contains', value: '' };
				break;
			case 'number_between':
				predicate = { kind: 'number_between', min: null, max: null };
				break;
		}
	}
</script>

<fieldset class="min-w-0 space-y-3">
	<legend class="label">{legend}</legend>
	<div>
		<label for="{id}-kind" class="sr-only">{legend} 종류</label>
		<select id="{id}-kind" class="input" value={predicate.kind} onchange={(e) => setKind((e.currentTarget as HTMLSelectElement).value as Predicate['kind'])}>
			{#each KINDS.filter((k) => allowAll || k.value !== 'all') as k (k.value)}
				<option value={k.value}>{k.label}</option>
			{/each}
		</select>
	</div>

	{#if predicate.kind === 'date_window'}
		<div>
			<label for="{id}-days" class="label">기간 (일)</label>
			<input id="{id}-days" type="number" min="1" max="3660" inputmode="numeric" class="input max-w-40" bind:value={predicate.days} aria-describedby="{id}-days-hint" />
			<p id="{id}-days-hint" class="hint mt-1">
				{predicate.days >= 1 ? windowLabel(predicate.days) : '1 이상 입력'}. 실행 시작일은 업무 시간대 기준 날짜입니다. 달의 길이와 상관없이 날짜 수로 계산합니다.
			</p>
		</div>
	{:else if predicate.kind === 'date_between'}
		<div class="grid gap-3 sm:grid-cols-2">
			<div>
				<label for="{id}-from" class="label">시작 날짜 (포함)</label>
				<input id="{id}-from" type="date" class="input" bind:value={predicate.from} />
			</div>
			<div>
				<label for="{id}-to" class="label">끝 날짜 (포함)</label>
				<input id="{id}-to" type="date" class="input" bind:value={predicate.to} />
			</div>
		</div>
	{:else if predicate.kind === 'equals' || predicate.kind === 'contains'}
		<div>
			<label for="{id}-value" class="label">{predicate.kind === 'equals' ? '같아야 하는 값' : '포함할 글자'}</label>
			<input id="{id}-value" class="input" bind:value={predicate.value} />
		</div>
	{:else if predicate.kind === 'number_between'}
		{@const p = predicate}
		<div class="grid gap-3 sm:grid-cols-2">
			<div>
				<label for="{id}-min" class="label">최솟값 (이상, 비우면 제한 없음)</label>
				<input id="{id}-min" class="input" inputmode="decimal" value={p.min ?? ''} oninput={(e) => (p.min = (e.currentTarget as HTMLInputElement).value.trim() || null)} />
			</div>
			<div>
				<label for="{id}-max" class="label">최댓값 (이하, 비우면 제한 없음)</label>
				<input id="{id}-max" class="input" inputmode="decimal" value={p.max ?? ''} oninput={(e) => (p.max = (e.currentTarget as HTMLInputElement).value.trim() || null)} />
			</div>
		</div>
	{/if}
</fieldset>
