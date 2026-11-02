<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { Plus, Trash, FileSpreadsheet, CalendarClock, CircleAlert } from '@lucide/svelte';
	import Button from '../Button.svelte';
	import Notice from '../Notice.svelte';
	import Modal from '../Modal.svelte';
	import PageHeader from '../PageHeader.svelte';
	import StatusBadge from '../StatusBadge.svelte';
	import PredicateEditor from './PredicateEditor.svelte';
	import { api, messageOf, newIdempotencyKey, ApiError } from '#lib/client/api.ts';
	import { announce } from '#lib/client/live.svelte.ts';
	import {
		WEEKDAYS,
		browserTimezone,
		describeOperation,
		fmtDateTime,
		fmtOccurrence,
		isValidZone,
		mimeLabel,
		nextOccurrences,
		FORMAT_LABEL
	} from '#lib/client/format.ts';
	import type { Draft, Grant, Operation, OutputFormat, PublicRun, SourceSelector, TaskPlan } from '#lib/client/types.ts';

	type Props = { draft: Draft; grants: Grant[] };
	let { draft: initial, grants }: Props = $props();

	const FORMATS: OutputFormat[] = ['xlsx', 'pptx', 'pdf', 'csv', 'tsv', 'png', 'jpeg'];
	const ZONES = ['Asia/Seoul', 'UTC', 'Asia/Tokyo', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney'];
	const btz = browserTimezone();
	const zoneOptions = [...new Set([btz, ...ZONES])];

	let draft = $state<Draft>(untrack(() => structuredClone(initial)));
	let plan = $state<TaskPlan>(untrack(() => structuredClone(initial.plan)));
	let saved = $state(untrack(() => JSON.stringify(initial.plan)));
	let timezoneConfirmed = $state(untrack(() => initial.plan.schedule.mode === 'recurring' && !initial.plan.unresolved_questions.some((q) => q.key === 'schedule.timezone')));
	let savedTzConfirmed = $state(untrack(() => timezoneConfirmed));

	let saving = $state(false);
	let confirming = $state(false);
	let saveMsg = $state<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);
	let errors = $state<{ id: string; text: string }[]>([]);
	let pickerOpen = $state(false);
	let pickerQuery = $state('');
	let newTime = $state('');
	let newTimeError = $state('');

	const readOnly = $derived(draft.status === 'confirmed' || draft.status === 'discarded');
	const dirty = $derived(JSON.stringify(plan) !== saved || timezoneConfirmed !== savedTzConfirmed);
	const unsupported = $derived(plan.limitations.filter((l) => l.startsWith('UNSUPPORTED:')));
	const canConfirm = $derived(!readOnly && !dirty && draft.status === 'ready' && draft.plan.unresolved_questions.length === 0 && unsupported.length === 0);
	const recurring = $derived(plan.schedule.mode === 'recurring');
	const occurrences = $derived.by(() => {
		const s = plan.schedule;
		if (s.mode !== 'recurring') return [];
		return nextOccurrences($state.snapshot(s.rule), s.timezone, new Date(), 3);
	});
	const grantById = $derived(new Map(grants.map((g) => [g.id, g])));
	const filteredGrants = $derived(grants.filter((g) => !pickerQuery.trim() || g.name.toLowerCase().includes(pickerQuery.trim().toLowerCase())));
	const questions = $derived(draft.plan.unresolved_questions);

	function kindOf(mime: string) {
		const m = mime.toLowerCase();
		if (m.includes('spreadsheet') || m.includes('excel')) return 'sheet';
		if (m.includes('presentation') || m.includes('powerpoint')) return 'slides';
		if (m === 'text/csv' || m.includes('tab-separated')) return 'csv';
		return 'other';
	}

	function defaultSelector(): SourceSelector {
		return { sheet: null, header_row: null, include_hidden_rows: false, include_hidden_slides: false, include_notes: false, csv_encoding: 'utf-8' };
	}

	function useGrant(g: Grant, replaceIndex: number | null = null) {
		const src = { grant_id: g.id, provider_file_id: g.providerFileId, name: g.name, mime_type: g.mimeType, selector: defaultSelector() };
		if (plan.sources.some((s) => s.grant_id === g.id)) return;
		if (replaceIndex !== null && plan.sources[replaceIndex]) plan.sources[replaceIndex] = src;
		else plan.sources.push(src);
		announce(`${g.name}을(를) 원본 파일로 선택했습니다`);
	}

	function removeSource(i: number) {
		plan.sources.splice(i, 1);
		for (const op of plan.operations) if ('source_index' in op && op.source_index > i) op.source_index--;
	}

	function addOperation(type: Operation['type']) {
		if (type === 'filter_rows') plan.operations.push({ type, source_index: 0, column: null, predicate: { kind: 'all' } });
		else if (type === 'aggregate') plan.operations.push({ type, source_index: 0, column: null, fn: 'count', filter_column: null, filter: { kind: 'all' } });
		else plan.operations.push({ type: 'answer', question: plan.goal, claim_keys: [] });
	}

	function setRecurring(on: boolean) {
		if (on && plan.schedule.mode !== 'recurring') {
			// No default days or times: the user chooses them explicitly.
			plan.schedule = { mode: 'recurring', raw_text: plan.original_prompt, rule: { kind: 'weekly', weekdays: [], times: [] }, timezone: plan.date_policy.timezone || btz, holidays: { exclude: false } };
			timezoneConfirmed = false;
		} else if (!on) {
			plan.schedule = { mode: 'manual' };
		}
	}

	function setRuleKind(kind: 'weekly' | 'daily') {
		const s = plan.schedule;
		if (s.mode !== 'recurring') return;
		s.rule = kind === 'daily' ? { kind: 'daily', times: [...s.rule.times] } : { kind: 'weekly', weekdays: [], times: [...s.rule.times] };
	}

	function toggleWeekday(n: number, on: boolean) {
		const s = plan.schedule;
		if (s.mode !== 'recurring' || s.rule.kind !== 'weekly') return;
		const set = new Set(s.rule.weekdays);
		if (on) set.add(n);
		else set.delete(n);
		s.rule.weekdays = [...set].sort((a, b) => a - b);
	}

	function addTime() {
		newTimeError = '';
		const s = plan.schedule;
		if (s.mode !== 'recurring') return;
		if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(newTime)) {
			newTimeError = '시각을 HH:MM 형식으로 입력하세요.';
			return;
		}
		if (!s.rule.times.includes(newTime)) s.rule.times = [...s.rule.times, newTime].sort();
		newTime = '';
	}

	function setZone(tz: string) {
		const s = plan.schedule;
		if (s.mode !== 'recurring') return;
		if (s.timezone !== tz) timezoneConfirmed = false;
		s.timezone = tz;
	}

	function answerQuestionTimezone(tz: string) {
		const s = plan.schedule;
		if (s.mode !== 'recurring') return;
		s.timezone = tz;
		timezoneConfirmed = true;
	}

	function validate(): { id: string; text: string }[] {
		const out: { id: string; text: string }[] = [];
		if (!plan.title.trim()) out.push({ id: 'plan-title', text: '업무 이름을 입력하세요.' });
		if (!plan.goal.trim()) out.push({ id: 'plan-goal', text: '목표를 입력하세요.' });
		plan.operations.forEach((op, i) => {
			if ('source_index' in op && plan.sources.length && op.source_index >= plan.sources.length) out.push({ id: `op-${i}-source`, text: `작업 ${i + 1}의 파일을 선택하세요.` });
			const preds = op.type === 'filter_rows' ? [op.predicate] : op.type === 'aggregate' ? [op.filter] : [];
			for (const p of preds) {
				if (p.kind === 'date_window' && !(Number.isInteger(p.days) && p.days >= 1 && p.days <= 3660)) out.push({ id: `op-${i}-pred-days`, text: `작업 ${i + 1}: 기간은 1~3660일입니다.` });
				if (p.kind === 'date_between' && (!/^\d{4}-\d{2}-\d{2}$/.test(p.from) || !/^\d{4}-\d{2}-\d{2}$/.test(p.to))) out.push({ id: `op-${i}-pred-from`, text: `작업 ${i + 1}: 시작·끝 날짜를 모두 입력하세요.` });
				if ((p.kind === 'equals' || p.kind === 'contains') && !p.value.trim()) out.push({ id: `op-${i}-pred-value`, text: `작업 ${i + 1}: 조건 값을 입력하세요.` });
				if (p.kind === 'number_between' && [p.min, p.max].some((v) => v !== null && !/^-?\d+(\.\d+)?$/.test(v))) out.push({ id: `op-${i}-pred-min`, text: `작업 ${i + 1}: 숫자 범위는 숫자로 입력하세요 (예: 1000, -2.5).` });
			}
			if (op.type === 'answer') {
				if (!op.question.trim()) out.push({ id: `op-${i}-question`, text: `작업 ${i + 1}: 질문을 입력하세요.` });
				if (op.claim_keys.some((k) => !/^[a-z0-9_.:-]{1,64}$/.test(k))) out.push({ id: `op-${i}-keys`, text: `작업 ${i + 1}: 비교 항목 키는 영문 소문자·숫자·_.:- 만 씁니다.` });
			}
		});
		const s = plan.schedule;
		if (s.mode === 'recurring') {
			if (s.rule.kind === 'weekly' && s.rule.weekdays.length === 0) out.push({ id: 'wd-1', text: '반복할 요일을 하나 이상 고르세요.' });
			if (s.rule.times.length === 0) out.push({ id: 'new-time', text: '실행 시각을 하나 이상 추가하세요.' });
			if (!isValidZone(s.timezone)) out.push({ id: 'sched-tz', text: '예약 시간대가 올바른 IANA 이름이 아닙니다 (예: Asia/Seoul).' });
		}
		if (!isValidZone(plan.date_policy.timezone)) out.push({ id: 'date-tz', text: '날짜 기준 시간대가 올바르지 않습니다.' });
		return out;
	}

	async function save(): Promise<boolean> {
		saveMsg = null;
		errors = validate();
		if (errors.length) {
			saveMsg = { tone: 'danger', text: `저장 전에 ${errors.length}개 항목을 고치세요.` };
			return false;
		}
		saving = true;
		try {
			const d = await api<Draft>(`/api/task-drafts/${draft.id}`, { method: 'PATCH', body: { expectedRevision: draft.revision, plan: $state.snapshot(plan), timezoneConfirmed } });
			draft = d;
			plan = structuredClone(d.plan);
			saved = JSON.stringify(d.plan);
			savedTzConfirmed = timezoneConfirmed;
			const left = d.plan.unresolved_questions.length;
			saveMsg = left ? { tone: 'warning', text: `저장했습니다. 남은 질문 ${left}개에 답해야 업무를 만들 수 있습니다.` } : { tone: 'success', text: '저장했습니다. 내용을 확인한 뒤 업무를 만드세요.' };
			announce(saveMsg.text);
			return true;
		} catch (e) {
			saveMsg = { tone: 'danger', text: e instanceof ApiError && e.code === 'CONFLICT' ? '다른 곳에서 이 계획이 바뀌었습니다. 새로고침한 뒤 다시 확인하세요.' : messageOf(e) };
			return false;
		} finally {
			saving = false;
		}
	}

	async function confirmTask(runNow: boolean) {
		saveMsg = null;
		confirming = true;
		try {
			const r = await api<{ taskId: string; duplicate: boolean }>(`/api/task-drafts/${draft.id}/confirm`, { method: 'POST', body: { revision: draft.revision } });
			if (runNow) {
				const run = await api<{ run: PublicRun; duplicate: boolean }>(`/api/tasks/${r.taskId}/runs`, { method: 'POST', idempotencyKey: newIdempotencyKey('run') });
				await goto(`/runs/${run.run.id}`);
			} else {
				await goto(`/tasks/${r.taskId}?created=1`);
			}
		} catch (e) {
			saveMsg = { tone: 'danger', text: messageOf(e) };
		} finally {
			confirming = false;
		}
	}

	function fieldError(id: string) {
		return errors.find((e) => e.id === id)?.text;
	}
</script>

<div class="max-w-4xl pb-28 md:pb-6">
	<PageHeader title="업무 계획 확인" description="요청을 해석한 계획입니다. 맞는지 확인하고 필요한 부분을 고친 뒤 저장하세요. 저장·확인 전에는 아무것도 실행하지 않습니다." back={{ href: '/', label: '홈' }}>
		{#snippet meta()}
			{#if draft.status === 'ready'}
				<StatusBadge tone="success" label="확인 준비됨" />
			{:else if draft.status === 'needs_input'}
				<StatusBadge tone="warning" label="답이 필요한 질문 있음" />
			{:else if draft.status === 'confirmed'}
				<StatusBadge tone="success" label="업무로 저장됨" />
			{:else}
				<StatusBadge tone="neutral" label={draft.status} />
			{/if}
			<span class="text-sm text-muted">계획 버전 {draft.revision}</span>
		{/snippet}
	</PageHeader>

	{#if draft.status === 'confirmed' && draft.confirmedTaskId}
		<Notice tone="success" title="이 계획은 이미 업무로 저장되었습니다" class="mb-5">
			<p><a href="/tasks/{draft.confirmedTaskId}">저장된 업무 보기</a></p>
		</Notice>
	{/if}

	<div class="space-y-5">
		<section class="card" aria-labelledby="orig-title">
			<h2 id="orig-title" class="section-title">요청 원문</h2>
			<blockquote class="mt-2 border-l-4 border-line pl-3 whitespace-pre-wrap text-muted">{plan.original_prompt}</blockquote>
		</section>

		{#if questions.length}
			<section class="card border-[#fcd34d]" aria-labelledby="q-title" data-testid="questions">
				<h2 id="q-title" class="section-title flex items-center gap-2"><CircleAlert size={20} class="text-warning" /> 확인이 필요한 질문 {questions.length}개</h2>
				<p class="hint mt-1">애매한 부분만 묻습니다. 답한 뒤 “변경 저장”을 누르면 남은 질문을 다시 확인합니다.</p>
				<ol class="mt-3 space-y-4">
					{#each questions as q, qi (q.key)}
						<li class="rounded-[8px] bg-warning-soft p-3">
							<p class="font-semibold">{qi + 1}. {q.question}</p>
							{#if q.key === 'source'}
								{#if grants.length === 0}
									<p class="mt-2">허용한 파일이 없습니다. <a href="/files">파일 허용 화면</a>에서 먼저 추가하세요.</p>
								{:else}
									<fieldset class="mt-2">
										<legend class="sr-only">사용할 허용 파일</legend>
										<ul class="space-y-1">
											{#each q.options.length ? q.options.map((o) => grantById.get(o.value)).filter((g): g is Grant => !!g) : grants.slice(0, 20) as g (g.id)}
												<li>
													<label class="check-row rounded-[8px] px-2 hover:bg-surface">
														<input type="radio" class="check" name="q-source" checked={plan.sources[0]?.grant_id === g.id} disabled={readOnly} onchange={() => useGrant(g, 0)} />
														<span class="min-w-0">
															<span class="block font-semibold break-words">{g.name}</span>
															<span class="block text-sm text-muted">{mimeLabel(g.mimeType)} · 수정 {fmtDateTime(g.modifiedAt)}{g.folderLabel ? ` · ${g.folderLabel}` : ''}</span>
														</span>
													</label>
												</li>
											{/each}
										</ul>
									</fieldset>
								{/if}
							{:else if q.key === 'schedule.timezone' && plan.schedule.mode === 'recurring'}
								<fieldset class="mt-2">
									<legend class="sr-only">예약 시간대</legend>
									{#each [...new Set([plan.schedule.timezone, ...q.options.map((o) => o.value)])] as tz (tz)}
										<label class="check-row px-2">
											<input type="radio" class="check" name="q-tz" checked={timezoneConfirmed && plan.schedule.timezone === tz} disabled={readOnly} onchange={() => answerQuestionTimezone(tz)} />
											<span>{tz}</span>
										</label>
									{/each}
								</fieldset>
							{:else if /^operations\.\d+\.column$/.test(q.key)}
								{@const idx = Number(q.key.split('.')[1])}
								{@const op = plan.operations[idx]}
								{#if op && op.type !== 'answer'}
									<label for="q-col-{idx}" class="label mt-2">열 이름 (원본 머리글 그대로)</label>
									<input id="q-col-{idx}" class="input max-w-md" value={op.column ?? ''} disabled={readOnly} oninput={(e) => (op.column = (e.currentTarget as HTMLInputElement).value.trim() || null)} data-testid="q-column-{idx}" />
								{/if}
							{:else if q.key === 'operations' || q.key.startsWith('operations.')}
								<p class="mt-2"><a href="#operations">작업 편집으로 이동</a></p>
							{:else if q.key.startsWith('schedule')}
								<p class="mt-2"><a href="#schedule">일정 편집으로 이동</a></p>
							{/if}
						</li>
					{/each}
				</ol>
			</section>
		{/if}

		<section class="card space-y-4" aria-labelledby="goal-title">
			<h2 id="goal-title" class="section-title">목표</h2>
			<div>
				<label for="plan-title" class="label">업무 이름</label>
				<input id="plan-title" class="input" bind:value={plan.title} maxlength={200} disabled={readOnly} aria-invalid={fieldError('plan-title') ? 'true' : undefined} />
			</div>
			<div>
				<label for="plan-goal" class="label">목표 (해석한 내용)</label>
				<textarea id="plan-goal" class="input" bind:value={plan.goal} maxlength={4000} disabled={readOnly} aria-invalid={fieldError('plan-goal') ? 'true' : undefined}></textarea>
			</div>
		</section>

		<section class="card" aria-labelledby="src-title" id="sources">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h2 id="src-title" class="section-title flex items-center gap-2"><FileSpreadsheet size={20} /> 원본 파일</h2>
				<Button size="sm" onclick={() => (pickerOpen = true)} disabled={readOnly || plan.sources.length >= 10} data-testid="open-source-picker"><Plus size={16} />허용한 파일에서 선택</Button>
			</div>
			<p class="hint mt-1">허용한 파일 중에서만 고를 수 있습니다. 실행할 때마다 같은 파일 ID의 최신 내용을 가져오며, 파일을 찾지 못하면 다른 파일로 대체하지 않고 오류로 알립니다.</p>
			{#if plan.sources.length === 0}
				<p class="mt-3 font-semibold text-warning">아직 선택한 파일이 없습니다.</p>
			{/if}
			<ol class="mt-3 space-y-4">
				{#each plan.sources as s, i (s.grant_id)}
					{@const g = grantById.get(s.grant_id)}
					{@const kind = kindOf(s.mime_type)}
					<li class="rounded-[8px] border border-line-soft p-3">
						<div class="flex flex-wrap items-start justify-between gap-2">
							<div class="min-w-0">
								<p class="font-semibold break-words">파일 {i + 1}. {s.name}</p>
								<p class="text-sm text-muted">{mimeLabel(s.mime_type)}{g ? ` · 수정 ${fmtDateTime(g.modifiedAt)}` : ' · 허용 목록에 없음'}{g?.folderLabel ? ` · ${g.folderLabel}` : ''}</p>
							</div>
							<Button size="sm" variant="ghost" onclick={() => removeSource(i)} disabled={readOnly} aria-label="파일 {i + 1} {s.name} 빼기"><Trash size={16} />빼기</Button>
						</div>
						<div class="mt-3 grid gap-3 sm:grid-cols-2">
							{#if kind === 'sheet' || kind === 'other'}
								<div>
									<label for="src-{i}-sheet" class="label">시트 이름</label>
									<input id="src-{i}-sheet" class="input" value={s.selector.sheet ?? ''} disabled={readOnly} oninput={(e) => (s.selector.sheet = (e.currentTarget as HTMLInputElement).value.trim() || null)} aria-describedby="src-{i}-sheet-h" />
									<p id="src-{i}-sheet-h" class="hint mt-1">비우면 첫 번째 시트</p>
								</div>
							{/if}
							{#if kind !== 'slides'}
								<div>
									<label for="src-{i}-hdr" class="label">머리글 행 번호</label>
									<input
										id="src-{i}-hdr"
										class="input"
										type="number"
										min="1"
										max="1000"
										inputmode="numeric"
										value={s.selector.header_row ?? ''}
										disabled={readOnly}
										oninput={(e) => {
											const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
											s.selector.header_row = Number.isInteger(v) && v >= 1 ? v : null;
										}}
										aria-describedby="src-{i}-hdr-h"
									/>
									<p id="src-{i}-hdr-h" class="hint mt-1">비우면 첫 행을 머리글로 봅니다</p>
								</div>
							{/if}
						</div>
						<div class="mt-2 flex flex-wrap gap-x-6">
							{#if kind === 'sheet' || kind === 'other'}
								<label class="check-row"><input type="checkbox" class="check" bind:checked={s.selector.include_hidden_rows} disabled={readOnly} />숨긴 행 포함</label>
							{/if}
							{#if kind === 'slides' || kind === 'other'}
								<label class="check-row"><input type="checkbox" class="check" bind:checked={s.selector.include_hidden_slides} disabled={readOnly} />숨긴 슬라이드 포함</label>
								<label class="check-row"><input type="checkbox" class="check" bind:checked={s.selector.include_notes} disabled={readOnly} />발표자 노트 포함</label>
							{/if}
						</div>
						{#if kind === 'csv' || kind === 'other'}
							<div class="mt-2 max-w-xs">
								<label for="src-{i}-enc" class="label">CSV/TSV 문자 인코딩</label>
								<select id="src-{i}-enc" class="input" bind:value={s.selector.csv_encoding} disabled={readOnly}>
									<option value="utf-8">UTF-8 (기본)</option>
									<option value="cp949">CP949 (한글 Windows 엑셀)</option>
								</select>
							</div>
						{/if}
					</li>
				{/each}
			</ol>
		</section>

		<section class="card" aria-labelledby="ops-title" id="operations">
			<h2 id="ops-title" class="section-title">작업</h2>
			<p class="hint mt-1">정해진 형식의 작업만 수행합니다. 자유 입력은 명령으로 실행되지 않습니다.</p>
			{#if plan.operations.length === 0}
				<p class="mt-3 font-semibold text-warning">아직 작업이 없습니다. 아래에서 추가하세요.</p>
			{/if}
			<ol class="mt-3 space-y-4">
				{#each plan.operations as op, i (i)}
					<li class="rounded-[8px] border border-line-soft p-3" data-testid="operation-{i}">
						<div class="flex flex-wrap items-start justify-between gap-2">
							<div class="min-w-0">
								<p class="font-semibold">작업 {i + 1}. {op.type === 'filter_rows' ? '조건에 맞는 행 찾기' : op.type === 'aggregate' ? '집계' : '질문에 답하기'}</p>
								<p class="text-sm break-words text-muted">{describeOperation(op, plan)}</p>
							</div>
							<Button size="sm" variant="ghost" onclick={() => plan.operations.splice(i, 1)} disabled={readOnly} aria-label="작업 {i + 1} 삭제"><Trash size={16} />삭제</Button>
						</div>
						<fieldset class="mt-3 grid min-w-0 gap-3" disabled={readOnly}>
							<legend class="sr-only">작업 {i + 1} 설정</legend>
							{#if op.type === 'filter_rows' || op.type === 'aggregate'}
								<div class="grid gap-3 sm:grid-cols-2">
									<div>
										<label for="op-{i}-source" class="label">파일</label>
										<select id="op-{i}-source" class="input" bind:value={op.source_index}>
											{#each plan.sources as s, si (s.grant_id)}<option value={si}>파일 {si + 1}. {s.name}</option>{/each}
											{#if plan.sources.length === 0}<option value={0}>(파일을 먼저 선택)</option>{/if}
										</select>
									</div>
									<div>
										<label for="op-{i}-column" class="label">{op.type === 'aggregate' ? '집계할 열' : '조건을 볼 열'} (원본 머리글 그대로)</label>
										<input id="op-{i}-column" class="input" value={op.column ?? ''} oninput={(e) => (op.column = (e.currentTarget as HTMLInputElement).value.trim() || null)} data-testid="op-{i}-column" />
									</div>
								</div>
								{#if op.type === 'filter_rows'}
									<PredicateEditor bind:predicate={op.predicate} id="op-{i}-pred" legend="행 조건" />
								{:else}
									<div class="max-w-xs">
										<label for="op-{i}-fn" class="label">계산</label>
										<select id="op-{i}-fn" class="input" bind:value={op.fn}>
											<option value="count">개수</option>
											<option value="sum">합계</option>
											<option value="avg">평균</option>
											<option value="min">최솟값</option>
											<option value="max">최댓값</option>
										</select>
									</div>
									<div>
										<label for="op-{i}-fcol" class="label">조건을 볼 열 (선택)</label>
										<input id="op-{i}-fcol" class="input" value={op.filter_column ?? ''} oninput={(e) => (op.filter_column = (e.currentTarget as HTMLInputElement).value.trim() || null)} />
									</div>
									<PredicateEditor bind:predicate={op.filter} id="op-{i}-pred" legend="집계할 행 조건" />
								{/if}
							{:else}
								<div>
									<label for="op-{i}-question" class="label">질문</label>
									<textarea id="op-{i}-question" class="input" bind:value={op.question} maxlength={4000}></textarea>
								</div>
								<div>
									<label for="op-{i}-keys" class="label">비교할 항목 키 (선택, 쉼표로 구분)</label>
									<input
										id="op-{i}-keys"
										class="input"
										value={op.claim_keys.join(', ')}
										oninput={(e) =>
											(op.claim_keys = (e.currentTarget as HTMLInputElement).value
												.split(',')
												.map((k) => k.trim())
												.filter(Boolean))}
										aria-describedby="op-{i}-keys-h"
									/>
									<p id="op-{i}-keys-h" class="hint mt-1">예: total_sales, deadline_count. 두 CLI가 같은 키로 답해야 항목별로 비교됩니다.</p>
								</div>
							{/if}
						</fieldset>
					</li>
				{/each}
			</ol>
			<div class="mt-3 flex flex-wrap gap-2">
				<Button size="sm" onclick={() => addOperation('filter_rows')} disabled={readOnly || plan.operations.length >= 20}><Plus size={16} />행 찾기</Button>
				<Button size="sm" onclick={() => addOperation('aggregate')} disabled={readOnly || plan.operations.length >= 20}><Plus size={16} />집계</Button>
				<Button size="sm" onclick={() => addOperation('answer')} disabled={readOnly || plan.operations.length >= 20}><Plus size={16} />질문 답하기</Button>
			</div>
		</section>

		<section class="card" aria-labelledby="out-title">
			<h2 id="out-title" class="section-title">결과물</h2>
			<p class="mt-1">웹 화면 결과는 항상 만듭니다. 원본 파일은 수정하지 않고, 다운로드 파일은 새 복사본으로 만듭니다.</p>
			<fieldset class="mt-3" disabled={readOnly}>
				<legend class="label">다운로드 파일 형식</legend>
				<div class="grid grid-cols-1 gap-x-6 sm:grid-cols-2 md:grid-cols-3">
					{#each FORMATS as f (f)}
						<label class="check-row">
							<input
								type="checkbox"
								class="check"
								checked={plan.outputs.downloads.includes(f)}
								onchange={(e) => {
									const on = (e.currentTarget as HTMLInputElement).checked;
									plan.outputs.downloads = on ? [...plan.outputs.downloads, f] : plan.outputs.downloads.filter((x) => x !== f);
								}}
							/>
							{FORMAT_LABEL[f]}
						</label>
					{/each}
				</div>
			</fieldset>
			{#if plan.outputs.downloads.includes('csv') || plan.outputs.downloads.includes('tsv')}
				<div class="mt-3 max-w-xs">
					<label for="out-enc" class="label">CSV/TSV 저장 인코딩</label>
					<select id="out-enc" class="input" bind:value={plan.outputs.csv_encoding} disabled={readOnly}>
						<option value="utf-8">UTF-8</option>
						<option value="utf-8-bom">UTF-8 (BOM, 엑셀 호환)</option>
						<option value="cp949">CP949</option>
					</select>
				</div>
			{/if}
		</section>

		<section class="card" aria-labelledby="sched-title" id="schedule">
			<h2 id="sched-title" class="section-title flex items-center gap-2"><CalendarClock size={20} /> 일정</h2>
			<fieldset class="mt-2" disabled={readOnly}>
				<legend class="sr-only">실행 방식</legend>
				<label class="check-row"><input type="radio" class="check" name="sched-mode" checked={!recurring} onchange={() => setRecurring(false)} />직접 실행할 때만</label>
				<label class="check-row"><input type="radio" class="check" name="sched-mode" checked={recurring} onchange={() => setRecurring(true)} data-testid="sched-recurring" />반복 예약</label>
			</fieldset>

			{#if plan.schedule.mode === 'recurring'}
				{@const s = plan.schedule}
				<div class="mt-3 space-y-4 border-t border-line-soft pt-3">
					{#if s.raw_text}<p class="hint">요청 표현: “{s.raw_text}”</p>{/if}
					<div class="max-w-xs">
						<label for="rule-kind" class="label">반복</label>
						<select id="rule-kind" class="input" value={s.rule.kind} disabled={readOnly} onchange={(e) => setRuleKind((e.currentTarget as HTMLSelectElement).value as 'weekly' | 'daily')}>
							<option value="weekly">요일 지정</option>
							<option value="daily">매일</option>
						</select>
					</div>
					{#if s.rule.kind === 'weekly'}
						{@const rule = s.rule}
						<fieldset disabled={readOnly}>
							<legend class="label">요일</legend>
							<div class="flex flex-wrap gap-2">
								{#each WEEKDAYS as w (w.n)}
									<label class="check-row rounded-[8px] border border-line px-3">
										<input id="wd-{w.n}" type="checkbox" class="check" checked={rule.weekdays.includes(w.n)} onchange={(e) => toggleWeekday(w.n, (e.currentTarget as HTMLInputElement).checked)} />
										<span>{w.short}<span class="sr-only">요일</span></span>
									</label>
								{/each}
							</div>
							{#if fieldError('wd-1')}<p class="mt-1 text-sm font-semibold text-danger">{fieldError('wd-1')}</p>{/if}
						</fieldset>
					{/if}
					<div>
						<p class="label" id="times-label">실행 시각</p>
						{#if s.rule.times.length}
							<ul class="flex flex-wrap gap-2" aria-labelledby="times-label">
								{#each s.rule.times as t (t)}
									<li class="inline-flex items-center gap-1 rounded-full border border-line bg-subtle pl-3">
										<span class="font-semibold">{t}</span>
										<button type="button" class="inline-flex size-11 items-center justify-center rounded-full hover:bg-line-soft" aria-label="{t} 시각 삭제" disabled={readOnly} onclick={() => (s.rule.times = s.rule.times.filter((x) => x !== t))}>
											<Trash size={16} />
										</button>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="hint">아직 시각이 없습니다. 기본 시각을 넣지 않습니다.</p>
						{/if}
						<div class="mt-2 flex flex-wrap items-end gap-2">
							<div>
								<label for="new-time" class="sr-only">추가할 시각</label>
								<input id="new-time" type="time" class="input w-40" bind:value={newTime} disabled={readOnly} aria-invalid={newTimeError || fieldError('new-time') ? 'true' : undefined} />
							</div>
							<Button size="sm" onclick={addTime} disabled={readOnly}><Plus size={16} />시각 추가</Button>
						</div>
						{#if newTimeError || fieldError('new-time')}<p class="mt-1 text-sm font-semibold text-danger">{newTimeError || fieldError('new-time')}</p>{/if}
					</div>
					<div class="max-w-md">
						<label for="sched-tz" class="label">시간대 (IANA)</label>
						<input id="sched-tz" class="input" list="tz-list" value={s.timezone} disabled={readOnly} oninput={(e) => setZone((e.currentTarget as HTMLInputElement).value.trim())} aria-invalid={isValidZone(s.timezone) ? undefined : 'true'} />
						<label class="check-row mt-1">
							<input type="checkbox" class="check" bind:checked={timezoneConfirmed} disabled={readOnly} data-testid="tz-confirm" />
							<span>예약 시간대 <strong>{s.timezone}</strong>을(를) 확인했습니다</span>
						</label>
					</div>
					<div>
						<p class="label">다음 3회 실행 예정 ({s.timezone})</p>
						{#if occurrences.length}
							<ol class="list-decimal space-y-0.5 pl-6" data-testid="next-occurrences">
								{#each occurrences as o (o.toMillis())}<li>{fmtOccurrence(o)}</li>{/each}
							</ol>
						{:else}
							<p class="hint">요일과 시각을 정하면 다음 실행 시각을 보여줍니다.</p>
						{/if}
						<p class="hint mt-1">공휴일 제외 규칙은 없습니다. 요청에 공휴일 처리가 있으면 아래 “제한 사항”에 표시합니다.</p>
					</div>
				</div>
			{/if}
		</section>

		<section class="card" aria-labelledby="policy-title">
			<h2 id="policy-title" class="section-title">날짜·숫자 기준</h2>
			<div class="mt-3 grid gap-3 sm:grid-cols-3">
				<div class="sm:col-span-3">
					<label for="date-tz" class="label">날짜 기준 시간대</label>
					<input id="date-tz" class="input max-w-md" list="tz-list" bind:value={plan.date_policy.timezone} disabled={readOnly} aria-describedby="date-tz-h" aria-invalid={isValidZone(plan.date_policy.timezone) ? undefined : 'true'} />
					<p id="date-tz-h" class="hint mt-1">“오늘”은 실행이 시작된 날짜를 이 시간대로 계산합니다.</p>
				</div>
				<div>
					<label for="round" class="label">반올림</label>
					<select id="round" class="input" bind:value={plan.number_policy.rounding} disabled={readOnly}>
						<option value="none">하지 않음</option>
						<option value="half_up">반올림 (half up)</option>
					</select>
				</div>
				<div>
					<label for="digits" class="label">소수 자릿수</label>
					<input id="digits" type="number" min="0" max="10" class="input" bind:value={plan.number_policy.digits} disabled={readOnly || plan.number_policy.rounding === 'none'} />
				</div>
			</div>
		</section>

		<section class="card" aria-labelledby="notify-title">
			<h2 id="notify-title" class="section-title">알림</h2>
			<p class="hint mt-1">이 업무의 결과를 받을 채널입니다. 채널마다 따로 켜고 끄며, 한쪽이 안 되어도 다른 쪽으로 자동 대체하지 않습니다. 수신 주소·기기 등록은 <a href="/settings">알림·설정</a>에서 합니다.</p>
			<fieldset class="mt-2 flex flex-wrap gap-x-6" disabled={readOnly}>
				<legend class="sr-only">알림 채널</legend>
				<label class="check-row"><input type="checkbox" class="check" bind:checked={plan.notifications.email} />이메일</label>
				<label class="check-row"><input type="checkbox" class="check" bind:checked={plan.notifications.push} />브라우저 푸시</label>
			</fieldset>
		</section>

		{#if plan.external_actions.length}
			<section class="card" aria-labelledby="ext-title">
				<h2 id="ext-title" class="section-title">외부 전송</h2>
				<p class="hint mt-1">실행마다 만들어진 파일의 hash와 대상을 확인하고 직접 승인해야만 전송합니다.</p>
				<ul class="mt-2 space-y-2">
					{#each plan.external_actions as a, i (i)}
						<li class="flex flex-wrap items-center justify-between gap-2">
							<span>Drive에 {FORMAT_LABEL[a.format]} 복사본 올리기 → {a.destination_label}</span>
							<Button size="sm" variant="ghost" disabled={readOnly} onclick={() => plan.external_actions.splice(i, 1)}><Trash size={16} />빼기</Button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if plan.limitations.length}
			<section class="card" aria-labelledby="lim-title">
				<h2 id="lim-title" class="section-title">제한 사항</h2>
				<ul class="mt-2 list-disc space-y-1 pl-5">
					{#each plan.limitations as l (l)}
						<li class={l.startsWith('UNSUPPORTED:') ? 'font-semibold text-danger' : ''}>{l.startsWith('UNSUPPORTED:') ? `지원하지 않음 — ${l.slice(12).trim()}` : l}</li>
					{/each}
				</ul>
			</section>
		{/if}
	</div>

	<datalist id="tz-list">
		{#each zoneOptions as z (z)}<option value={z}></option>{/each}
	</datalist>

	<!-- Action bar: sticky on phones so save/confirm are always reachable. -->
	<div class="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:static md:mt-6 md:rounded-[8px] md:border md:px-5 md:py-4 lg:ml-0" data-testid="draft-actions">
		<div class="mx-auto max-w-4xl space-y-3">
			{#if errors.length}
				<div role="alert" class="text-sm">
					<p class="font-semibold text-danger">고칠 항목</p>
					<ul class="list-disc pl-5">
						{#each errors as e (e.id + e.text)}<li><a href="#{e.id}">{e.text}</a></li>{/each}
					</ul>
				</div>
			{/if}
			{#if saveMsg}
				<p class="text-sm font-semibold {saveMsg.tone === 'danger' ? 'text-danger' : saveMsg.tone === 'warning' ? 'text-warning' : 'text-primary'}" role={saveMsg.tone === 'danger' ? 'alert' : 'status'} data-testid="save-message">{saveMsg.text}</p>
			{/if}
			{#if !readOnly}
				<div class="flex flex-wrap items-center gap-2">
					<Button variant={dirty ? 'primary' : 'secondary'} onclick={save} disabled={saving || confirming} aria-busy={saving} data-testid="save-draft">{saving ? '저장 중…' : dirty ? '변경 저장' : '저장됨'}</Button>
					<Button variant="primary" onclick={() => confirmTask(false)} disabled={!canConfirm || confirming} data-testid="confirm-save">{recurring ? '예약 저장' : '업무 저장'}</Button>
					<Button onclick={() => confirmTask(true)} disabled={!canConfirm || confirming} data-testid="confirm-run">{recurring ? '예약 저장 후 지금 한 번 실행' : '저장하고 지금 실행'}</Button>
				</div>
				<p class="hint">
					{#if dirty}
						바뀐 내용을 먼저 저장해야 업무를 만들 수 있습니다.
					{:else if !canConfirm}
						남은 질문을 해결하면 업무를 만들 수 있습니다.
					{:else if recurring}
						“예약 저장”은 정한 시각에만 실행합니다. “지금 한 번 실행”은 저장 직후 1회를 대기열에 추가합니다.
					{:else}
						“업무 저장”은 실행하지 않고 저장만 합니다. “지금 실행”은 저장 직후 1회를 대기열에 추가합니다.
					{/if}
				</p>
			{/if}
		</div>
	</div>
</div>

<Modal bind:open={pickerOpen} title="허용한 파일에서 선택" description="허용 목록에 있는 파일만 표시합니다. Drive 전체를 검색하지 않습니다." variant="full" testid="source-picker">
	{#if grants.length === 0}
		<p>허용한 파일이 없습니다. <a href="/files">파일 허용 화면</a>에서 Drive 파일을 먼저 추가하세요.</p>
	{:else}
		<label for="picker-q" class="label">허용된 파일만 검색</label>
		<input id="picker-q" type="search" class="input" bind:value={pickerQuery} autocomplete="off" />
		<ul class="mt-3 divide-y divide-line-soft">
			{#each filteredGrants as g (g.id)}
				{@const chosen = plan.sources.some((s) => s.grant_id === g.id)}
				<li class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
					<div class="min-w-0">
						<p class="font-semibold break-words">{g.name}</p>
						<p class="text-sm text-muted">{mimeLabel(g.mimeType)} · 수정 {fmtDateTime(g.modifiedAt)} · {g.folderLabel ? `폴더 ${g.folderLabel}` : '폴더 정보 없음'}</p>
					</div>
					<Button size="sm" variant={chosen ? 'secondary' : 'primary'} disabled={chosen} onclick={() => (useGrant(g), (pickerOpen = false))} aria-label="{g.name} 선택">{chosen ? '선택됨' : '선택'}</Button>
				</li>
			{:else}
				<li class="py-3">“{pickerQuery}”와 맞는 허용 파일이 없습니다.</li>
			{/each}
		</ul>
	{/if}
</Modal>
