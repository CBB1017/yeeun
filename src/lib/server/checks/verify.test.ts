import { describe, expect, it } from 'vitest';
import { checkResult, compareResults, expectedFor } from './verify';
import { defaultSelector, emptyPlan, type TaskPlan } from '../../shared/plan';
import type { SourceManifest } from '../../shared/manifest';
import type { AnalysisResult } from '../../shared/protocol';

function manifest(rows: [string, string | null, string | null][]): SourceManifest {
	return {
		schema_version: 1,
		run_id: 'r',
		files: [
			{
				index: 0,
				snapshot_id: 's',
				provider_file_id: 'f',
				name: 'a.xlsx',
				mime_type: 'x',
				provider_revision: null,
				provider_modified_at: null,
				captured_at: '2026-11-02T00:00:00Z',
				sha256: 'h',
				export_format: null,
				extraction_version: 'v',
				texts: [],
				warnings: [],
				tables: [
					{
						table_id: 't',
						kind: 'sheet',
						label: 'S',
						header_row: 1,
						merged_ranges: [],
						columns: [
							{ column_id: 'A', label: '과제', index: 1 },
							{ column_id: 'B', label: '마감일', index: 2 },
							{ column_id: 'C', label: '금액', index: 3 }
						],
						rows: rows.map(([name, date, amount], i) => ({
							record_id: `r${i + 2}`,
							row_number: i + 2,
							hidden: false,
							evidence_id: `r${i + 2}`,
							cells: [
								{ column_id: 'A', evidence_id: `A${i + 2}`, type: 'string', value: name, display: name, formula: null },
								{
									column_id: 'B',
									evidence_id: `B${i + 2}`,
									type: date && /^\d{4}-/.test(date) ? 'date' : 'string',
									value: date,
									display: date,
									formula: null
								},
								{
									column_id: 'C',
									evidence_id: `C${i + 2}`,
									type: amount ? 'number' : 'empty',
									value: amount,
									display: amount,
									formula: null
								}
							]
						}))
					}
				]
			}
		]
	};
}

function plan(ops: TaskPlan['operations'], digits = 2): TaskPlan {
	const p = emptyPlan('x', 'Asia/Seoul');
	p.sources = [
		{ grant_id: '0190f0a0-0000-7000-8000-000000000001', provider_file_id: 'f', name: 'a.xlsx', mime_type: 'x', selector: defaultSelector() }
	];
	p.operations = ops;
	p.number_policy = { rounding: 'half_up', digits };
	return p;
}

const result = (records: string[], claims: AnalysisResult['claims'] = [], provider: 'claude' | 'codex' = 'claude'): AnalysisResult => ({
	schema_version: 1,
	run_id: 'r',
	round: 1,
	provider,
	manifest_hash: 'H',
	status: 'ok',
	summary: '',
	uncertainties: [],
	claims,
	records: records.map((r) => ({ operation_index: 0, source_record_id: r, evidence_ids: [r] }))
});

describe('code verification (A07/A11)', () => {
	const m = manifest([
		['A', '2026-11-02', '0.1'],
		['B', '2026-12-01', '0.2'],
		['C', '2026-12-02', '10'],
		['D', '12/01', '5'] // unrecognised date text: never silently converted
	]);
	const filter = plan([
		{ type: 'filter_rows', source_index: 0, column: '마감일', predicate: { kind: 'date_window', start: 'reference_date', days: 30 } }
	]);

	it('Nov 2 window includes Dec 1, excludes Dec 2, and reports unverifiable dates', () => {
		const exp = expectedFor(filter, m, '2026-11-02');
		expect(exp.expected[0]!.recordIds).toEqual(['r2', 'r3']);
		expect(exp.expected[0]!.unverifiable).toEqual(['r5']);
		expect(exp.warnings[0]).toContain('자동 보정하지 않음');
	});

	it('extra, missing, foreign-evidence and wrong-manifest results fail regardless of model agreement', () => {
		const exp = expectedFor(filter, m, '2026-11-02');
		expect(checkResult(filter, m, 'H', result(['r2', 'r3']), exp)).toEqual([]);
		expect(checkResult(filter, m, 'H', result(['r2', 'r3', 'r5']), exp).map((f) => f.code)).toContain('record_set_mismatch');
		const wrongEv = result(['r2', 'r3']);
		wrongEv.records[0]!.evidence_ids = ['B3'];
		expect(checkResult(filter, m, 'H', wrongEv, exp).map((f) => f.code)).toContain('evidence_wrong_record');
		expect(checkResult(filter, m, 'OTHER', result(['r2', 'r3']), exp).map((f) => f.code)).toContain('manifest_mismatch');
	});

	it('aggregates are exact decimals with the confirmed rounding; no tolerance', () => {
		const p = plan([
			{
				type: 'aggregate',
				source_index: 0,
				column: '금액',
				fn: 'sum',
				filter_column: '마감일',
				filter: { kind: 'date_window', start: 'reference_date', days: 30 }
			}
		]);
		const mm = manifest([
			['A', '2026-11-02', '0.1'],
			['B', '2026-11-03', '0.2']
		]);
		const exp = expectedFor(p, mm, '2026-11-02');
		expect(exp.expected[0]!.value).toBe('0.3');
		const claim = (v: string) => [{ claim_key: 'op0.sum', value: { type: 'number' as const, value: v }, unit: null, evidence_ids: ['C2'] }];
		expect(checkResult(p, mm, 'H', result([], claim('0.30')), exp)).toEqual([]);
		expect(checkResult(p, mm, 'H', result([], claim('0.30000000000000004')), exp).map((f) => f.code)).toContain('numeric_mismatch');
		const avg = plan([{ type: 'aggregate', source_index: 0, column: '금액', fn: 'avg', filter_column: null, filter: { kind: 'all' } }], 2);
		expect(
			expectedFor(
				avg,
				manifest([
					['A', null, '1'],
					['B', null, '2'],
					['C', null, '2']
				]),
				'2026-11-02'
			).expected[0]!.value
		).toBe('1.67');
	});

	it('field comparison ignores prose but flags record and declared-claim differences', () => {
		const p = plan([
			{ type: 'filter_rows', source_index: 0, column: '마감일', predicate: { kind: 'all' } },
			{ type: 'answer', question: 'q', claim_keys: ['total'] }
		]);
		const a = result(
			['r2'],
			[{ claim_key: 'total', value: { type: 'number', value: '1,000' }, unit: '원', evidence_ids: ['C2'] }],
			'claude'
		);
		const b = result(
			['r2'],
			[{ claim_key: 'total', value: { type: 'number', value: '1000.0' }, unit: '원', evidence_ids: ['C2'] }],
			'codex'
		);
		a.summary = '표현 A';
		b.summary = '완전히 다른 표현 B';
		expect(compareResults(a, b, p)).toEqual([]);
		b.records.push({ operation_index: 0, source_record_id: 'r3', evidence_ids: ['r3'] });
		expect(compareResults(a, b, p).map((d) => d.field)).toEqual(['operation[0].records']);
	});
});
