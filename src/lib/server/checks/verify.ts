import type { TaskPlan, Operation, Predicate } from '../../shared/plan';
import { evidenceIndex, type SourceManifest, type Table, type Cell } from '../../shared/manifest';
import type { AnalysisResult, Claim, Difference } from '../../shared/protocol';
import { AppError } from '../errors';
import { dateWindow, inRange } from './dates';
import { add, canonicalNumber, cmp, div, fromInt, parseDec, roundHalfUp, toCanonical, type Dec } from './decimal';

/**
 * Deterministic, code-side verification. These checks are authoritative: a
 * model verdict of "agree" can never override a failure here.
 */

export interface ExpectedOp {
	index: number;
	type: Operation['type'];
	recordIds?: string[];
	unverifiable?: string[];
	claimKey?: string;
	value?: string | null;
	window?: { from: string; to: string };
	columnLabel?: string;
}

export interface CheckFailure {
	provider?: 'claude' | 'codex';
	code: string;
	detail: string;
}

export interface CheckReport {
	ok: boolean;
	failures: CheckFailure[];
	warnings: string[];
	expected: ExpectedOp[];
}

const norm = (s: string) => s.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');

export function tableFor(manifest: SourceManifest, plan: TaskPlan, sourceIndex: number): Table {
	const file = manifest.files[sourceIndex];
	if (!file) throw new AppError('INPUT_REQUIRED', `source ${sourceIndex + 1} is missing`, 'preparing');
	const sheet = plan.sources[sourceIndex]?.selector.sheet;
	const tables = sheet ? file.tables.filter((t) => norm(t.label) === norm(sheet)) : file.tables;
	if (tables.length === 0) {
		throw new AppError('INPUT_REQUIRED', `table/sheet not found in ${file.name}`, 'preparing');
	}
	if (tables.length > 1) {
		throw new AppError('INPUT_REQUIRED', `${file.name} has several sheets/tables; choose one in the task plan`, 'preparing');
	}
	return tables[0]!;
}

export function columnId(table: Table, label: string): string {
	const matches = table.columns.filter((c) => norm(c.label) === norm(label));
	if (matches.length !== 1) {
		throw new AppError(
			'INPUT_REQUIRED',
			matches.length === 0
				? `column "${label}" not found in ${table.label}`
				: `column "${label}" is ambiguous in ${table.label} (duplicate headers)`,
			'preparing'
		);
	}
	return matches[0]!.column_id;
}

type Match = 'yes' | 'no' | 'unverifiable';

function matchPredicate(cell: Cell | undefined, p: Predicate, referenceDate: string): Match {
	if (p.kind === 'all') return 'yes';
	if (!cell || cell.type === 'empty' || cell.value === null) return 'no';
	switch (p.kind) {
		case 'date_window':
		case 'date_between': {
			if (cell.type !== 'date') return 'unverifiable';
			const w = p.kind === 'date_window' ? dateWindow(referenceDate, p.days) : { from: p.from, to: p.to };
			return inRange(cell.value, w.from, w.to) ? 'yes' : 'no';
		}
		case 'equals':
			return norm(cell.display ?? cell.value) === norm(p.value) || norm(cell.value) === norm(p.value) ? 'yes' : 'no';
		case 'contains':
			return norm(cell.display ?? cell.value).includes(norm(p.value)) ? 'yes' : 'no';
		case 'number_between': {
			if (cell.type !== 'number') return 'unverifiable';
			const v = parseDec(cell.value);
			if (!v) return 'unverifiable';
			if (p.min !== null && cmp(v, parseDec(p.min)!) < 0) return 'no';
			if (p.max !== null && cmp(v, parseDec(p.max)!) > 0) return 'no';
			return 'yes';
		}
	}
}

function filterRows(table: Table, column: string | null, p: Predicate, ref: string, includeHidden: boolean) {
	const colId = p.kind === 'all' || column === null ? null : columnId(table, column);
	const recordIds: string[] = [];
	const unverifiable: string[] = [];
	for (const row of table.rows) {
		if (row.hidden && !includeHidden) continue;
		const cell = colId ? row.cells.find((c) => c.column_id === colId) : undefined;
		const m = colId ? matchPredicate(cell, p, ref) : 'yes';
		if (m === 'yes') recordIds.push(row.record_id);
		else if (m === 'unverifiable') unverifiable.push(row.record_id);
	}
	return { recordIds, unverifiable };
}

export function aggregateKey(index: number, fn: string): string {
	return `op${index}.${fn}`;
}

/** Compute what the code can determine for each operation. */
export function expectedFor(plan: TaskPlan, manifest: SourceManifest, referenceDate: string): CheckReport {
	const expected: ExpectedOp[] = [];
	const warnings: string[] = [];
	plan.operations.forEach((op, index) => {
		if (op.type === 'answer') {
			expected.push({ index, type: op.type });
			return;
		}
		const table = tableFor(manifest, plan, op.source_index);
		const includeHidden = plan.sources[op.source_index]?.selector.include_hidden_rows ?? false;
		if (op.type === 'filter_rows') {
			const r = filterRows(table, op.column, op.predicate, referenceDate, includeHidden);
			if (r.unverifiable.length) {
				warnings.push(
					`작업 ${index + 1}: ${r.unverifiable.length}개 행의 "${op.column}" 값을 날짜/숫자로 확인할 수 없어 결과에서 제외됨 (자동 보정하지 않음)`
				);
			}
			expected.push({
				index,
				type: op.type,
				recordIds: r.recordIds,
				unverifiable: r.unverifiable,
				columnLabel: op.column ?? undefined,
				window:
					op.predicate.kind === 'date_window'
						? dateWindow(referenceDate, op.predicate.days)
						: op.predicate.kind === 'date_between'
							? { from: op.predicate.from, to: op.predicate.to }
							: undefined
			});
			return;
		}
		// aggregate
		const rows = filterRows(table, op.filter_column, op.filter, referenceDate, includeHidden);
		const key = aggregateKey(index, op.fn);
		if (rows.unverifiable.length) {
			expected.push({ index, type: op.type, claimKey: key, value: null, unverifiable: rows.unverifiable });
			warnings.push(`작업 ${index + 1}: 필터 열을 확인할 수 없는 행이 있어 집계를 코드로 검산할 수 없음`);
			return;
		}
		if (op.fn === 'count') {
			expected.push({ index, type: op.type, claimKey: key, value: String(rows.recordIds.length) });
			return;
		}
		const colId = columnId(table, op.column ?? '');
		const values: Dec[] = [];
		let bad = false;
		for (const rid of rows.recordIds) {
			const cell = table.rows.find((r) => r.record_id === rid)!.cells.find((c) => c.column_id === colId);
			if (!cell || cell.type === 'empty') continue;
			const d = cell.type === 'number' && cell.value ? parseDec(cell.value) : null;
			if (!d) bad = true;
			else values.push(d);
		}
		if (bad || values.length === 0) {
			expected.push({ index, type: op.type, claimKey: key, value: null });
			warnings.push(`작업 ${index + 1}: 집계 대상 값 중 숫자로 확인할 수 없는 값이 있어 코드 검산 불가`);
			return;
		}
		let out: Dec;
		if (op.fn === 'sum' || op.fn === 'avg') {
			out = values.reduce((a, b) => add(a, b), fromInt(0));
			if (op.fn === 'avg') out = div(out, fromInt(values.length), plan.number_policy.digits);
		} else {
			out = values.reduce((a, b) => (op.fn === 'min' ? (cmp(a, b) <= 0 ? a : b) : cmp(a, b) >= 0 ? a : b));
		}
		if (plan.number_policy.rounding === 'half_up' && op.fn !== 'avg') {
			out = roundHalfUp(out, plan.number_policy.digits);
		}
		expected.push({ index, type: op.type, claimKey: key, value: toCanonical(out) });
	});
	return { ok: true, failures: [], warnings, expected };
}

/** Validate one CLI result against the manifest and the code-computed expectations. */
export function checkResult(
	plan: TaskPlan,
	manifest: SourceManifest,
	manifestHash: string,
	result: AnalysisResult,
	exp: CheckReport
): CheckFailure[] {
	const f: CheckFailure[] = [];
	const p = result.provider;
	if (result.manifest_hash !== manifestHash) {
		f.push({ provider: p, code: 'manifest_mismatch', detail: '결과가 다른 원본 버전을 참조함' });
	}
	if (result.status !== 'ok') {
		f.push({ provider: p, code: `status_${result.status}`, detail: `실행 결과 상태: ${result.status}` });
	}
	const ev = evidenceIndex(manifest);
	for (const c of result.claims) {
		for (const id of c.evidence_ids) {
			if (!ev.has(id)) f.push({ provider: p, code: 'unknown_evidence', detail: `${c.claim_key}: 근거 ${id} 없음` });
		}
	}
	for (const r of result.records) {
		const op = plan.operations[r.operation_index];
		if (!op || op.type !== 'filter_rows') {
			f.push({ provider: p, code: 'bad_record_operation', detail: `레코드가 잘못된 작업 ${r.operation_index}을 참조` });
			continue;
		}
		for (const id of r.evidence_ids) {
			const e = ev.get(id);
			if (!e) f.push({ provider: p, code: 'unknown_evidence', detail: `레코드 ${r.source_record_id}: 근거 ${id} 없음` });
			else if (e.record_id !== r.source_record_id) {
				f.push({ provider: p, code: 'evidence_wrong_record', detail: `근거 ${id}가 레코드 ${r.source_record_id}에 속하지 않음` });
			}
		}
	}
	for (const e of exp.expected) {
		if (e.type === 'filter_rows' && e.recordIds) {
			const got = new Set(result.records.filter((r) => r.operation_index === e.index).map((r) => r.source_record_id));
			const want = new Set(e.recordIds);
			const missing = [...want].filter((x) => !got.has(x));
			const extra = [...got].filter((x) => !want.has(x));
			if (missing.length || extra.length) {
				f.push({
					provider: p,
					code: 'record_set_mismatch',
					detail: `작업 ${e.index + 1}: 코드 검산과 다름 (누락 ${missing.length}, 초과 ${extra.length})`
				});
			}
		}
		if (e.type === 'aggregate' && e.claimKey) {
			const claim = result.claims.find((c) => c.claim_key === e.claimKey);
			if (!claim) {
				f.push({ provider: p, code: 'claim_missing', detail: `${e.claimKey} 값 없음` });
			} else if (e.value !== null && e.value !== undefined) {
				const got = canonicalNumber(claim.value.value);
				if (got !== e.value) {
					f.push({ provider: p, code: 'numeric_mismatch', detail: `${e.claimKey}: ${claim.value.value} ≠ 검산 ${e.value}` });
				}
			}
		}
		if (e.type === 'answer') {
			const op = plan.operations[e.index] as Extract<Operation, { type: 'answer' }>;
			for (const key of op.claim_keys) {
				if (!result.claims.some((c) => c.claim_key === key)) {
					f.push({ provider: p, code: 'claim_missing', detail: `${key} 값 없음` });
				}
			}
		}
	}
	return f;
}

function claimText(c: Claim | undefined): string | null {
	if (!c) return null;
	const v =
		c.value.type === 'number' || c.value.type === 'count' ? (canonicalNumber(c.value.value) ?? c.value.value) : c.value.value.trim();
	return `${c.value.type}:${v}${c.unit ? ` ${c.unit}` : ''}`;
}

/** Field-level comparison of the two independent results (code part of comparison). */
export function compareResults(a: AnalysisResult, b: AnalysisResult, plan: TaskPlan): Difference[] {
	const [claude, codex] = a.provider === 'claude' ? [a, b] : [b, a];
	const diffs: Difference[] = [];
	const ops = new Set([...claude.records, ...codex.records].map((r) => r.operation_index));
	for (const op of ops) {
		const x = new Set(claude.records.filter((r) => r.operation_index === op).map((r) => r.source_record_id));
		const y = new Set(codex.records.filter((r) => r.operation_index === op).map((r) => r.source_record_id));
		const onlyX = [...x].filter((v) => !y.has(v));
		const onlyY = [...y].filter((v) => !x.has(v));
		if (onlyX.length || onlyY.length) {
			diffs.push({
				field: `operation[${op}].records`,
				claude_value: onlyX.join(', ') || null,
				codex_value: onlyY.join(', ') || null,
				reason: '대상 레코드가 다름'
			});
		}
	}
	// Only plan-declared claim keys are compared field by field; other prose is left to the reviewer.
	const keys = comparableClaimKeys(plan);
	for (const k of keys) {
		const x = claimText(claude.claims.find((c) => c.claim_key === k));
		const y = claimText(codex.claims.find((c) => c.claim_key === k));
		if (x !== y) diffs.push({ field: `claims.${k}`, claude_value: x, codex_value: y, reason: x && y ? '값이 다름' : '한쪽에만 있음' });
	}
	return diffs;
}

export function comparableClaimKeys(plan: TaskPlan): Set<string> {
	const keys = new Set<string>();
	plan.operations.forEach((op, i) => {
		if (op.type === 'aggregate') keys.add(aggregateKey(i, op.fn));
		if (op.type === 'answer') op.claim_keys.forEach((k) => keys.add(k));
	});
	return keys;
}
