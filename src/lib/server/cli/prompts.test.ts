import { describe, expect, it } from 'vitest';
import { renderSource, SOURCE_FORMAT_GUIDE } from './prompts';
import type { SourceManifest } from '../../shared/manifest';

function manifest(rows: number): SourceManifest {
	return {
		schema_version: 1,
		run_id: 'r',
		files: [
			{
				index: 0, snapshot_id: 's', provider_file_id: 'f', name: '연구|과제.xlsx', mime_type: 'x', provider_revision: null, provider_modified_at: null,
				captured_at: '2026-11-02T00:00:00Z', sha256: 'h', export_format: null, extraction_version: 'v', warnings: ['병합 머리글'],
				tables: [
					{
						table_id: 'f0.s0', kind: 'sheet', label: '과제', header_row: 1, merged_ranges: [],
						columns: [{ column_id: 'A', label: '과제명', index: 1 }, { column_id: 'B', label: '마감일', index: 2 }, { column_id: 'C', label: '비고', index: 3 }],
						rows: Array.from({ length: rows }, (_, i) => {
							const n = i + 2;
							return {
								record_id: `f0.s0.r${n}`, row_number: n, hidden: n === 3, evidence_id: `f0.s0.r${n}`,
								cells: [
									{ column_id: 'A', evidence_id: `f0.s0!A${n}`, type: 'string' as const, value: `과제 ${n}`, display: `과제 ${n}`, formula: null },
									{ column_id: 'B', evidence_id: `f0.s0!B${n}`, type: 'date' as const, value: '2026-11-30', display: '11/30', formula: null },
									{ column_id: 'C', evidence_id: `f0.s0!C${n}`, type: 'string' as const, value: 'a|b\nc', display: 'a|b\nc', formula: null }
								]
							};
						})
					}
				],
				texts: [{ evidence_id: 'f0.p1', kind: 'page', location: { page: 1 }, text: '본문', ocr_confidence: 55.4 }]
			}
		]
	};
}

describe('token-efficient source rendering', () => {
	it('renders one line per record with derivable ids, escapes separators, keeps hidden/ocr markers', () => {
		const out = renderSource(manifest(2));
		expect(out).toContain('# 파일 0: 연구\\|과제.xlsx');
		expect(out).toContain('경고: 병합 머리글');
		expect(out).toContain('열|A=과제명|B=마감일|C=비고');
		expect(out).toContain('2|과제 2|2026-11-30|a\\|b⏎c');
		expect(out).toContain('3*|과제 3|2026-11-30|a\\|b⏎c');
		expect(out).toContain('[f0.p1] (OCR 55) 본문'.replace('] (', '] ('));
		expect(SOURCE_FORMAT_GUIDE).toContain('<표ID>!<열ID><행번호>');
	});

	it('is several times smaller than the previous per-cell JSON form', () => {
		const m = manifest(300);
		const legacy = JSON.stringify(
			m.files.map((f) => ({
				tables: f.tables.map((t) => ({
					rows: t.rows.map((r) => ({ record_id: r.record_id, row: r.row_number, hidden: r.hidden, row_evidence_id: r.evidence_id, cells: Object.fromEntries(r.cells.map((c) => [c.column_id, { e: c.evidence_id, t: c.type, v: c.value, d: c.display === c.value ? undefined : c.display }])) }))
				}))
			}))
		);
		const compact = renderSource(m);
		expect(compact.length * 3).toBeLessThan(legacy.length);
	});

	it('falls back to explicit ids when a table does not follow the id convention', () => {
		const m = manifest(1);
		m.files[0]!.tables[0]!.rows[0]!.cells[0]!.evidence_id = 'weird-id';
		const out = renderSource(m);
		expect(out).toContain('## 표(명시형) f0.s0');
		expect(out).toContain('weird-id');
	});
});
