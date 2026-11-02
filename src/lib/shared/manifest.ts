import { z } from 'zod';

/** Parsed, frozen view of captured sources given identically to every CLI execution. */

export const CellSchema = z.strictObject({
	column_id: z.string(),
	evidence_id: z.string(),
	type: z.enum(['number', 'date', 'string', 'boolean', 'empty', 'error', 'formula_uncomputed']),
	/** Typed value as text: decimal string, YYYY-MM-DD, plain text, true/false. */
	value: z.string().nullable(),
	display: z.string().nullable(),
	formula: z.string().nullable()
});
export type Cell = z.infer<typeof CellSchema>;

export const TableSchema = z.strictObject({
	table_id: z.string(),
	kind: z.enum(['sheet', 'csv', 'slide_table', 'pdf_table', 'doc_table']),
	label: z.string(),
	header_row: z.number().int(),
	columns: z.array(z.strictObject({ column_id: z.string(), label: z.string(), index: z.number().int() })),
	rows: z.array(
		z.strictObject({
			record_id: z.string(),
			row_number: z.number().int(),
			hidden: z.boolean(),
			evidence_id: z.string(),
			cells: z.array(CellSchema)
		})
	),
	merged_ranges: z.array(z.string())
});
export type Table = z.infer<typeof TableSchema>;

export const TextBlockSchema = z.strictObject({
	evidence_id: z.string(),
	kind: z.enum(['page', 'slide', 'notes', 'region', 'chart', 'paragraph']),
	location: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
	text: z.string(),
	ocr_confidence: z.number().nullable()
});
export type TextBlock = z.infer<typeof TextBlockSchema>;

export const ManifestFileSchema = z.strictObject({
	index: z.number().int(),
	snapshot_id: z.string(),
	provider_file_id: z.string(),
	name: z.string(),
	mime_type: z.string(),
	provider_revision: z.string().nullable(),
	provider_modified_at: z.string().nullable(),
	captured_at: z.string(),
	sha256: z.string(),
	export_format: z.string().nullable(),
	extraction_version: z.string(),
	tables: z.array(TableSchema),
	texts: z.array(TextBlockSchema),
	warnings: z.array(z.string())
});
export type ManifestFile = z.infer<typeof ManifestFileSchema>;

export const SourceManifestSchema = z.strictObject({
	schema_version: z.literal(1),
	run_id: z.string(),
	files: z.array(ManifestFileSchema)
});
export type SourceManifest = z.infer<typeof SourceManifestSchema>;

export interface EvidenceEntry {
	evidence_id: string;
	file_index: number;
	kind: 'cell' | 'row' | 'page' | 'slide' | 'notes' | 'region' | 'chart' | 'paragraph';
	location: Record<string, string | number | boolean | null>;
	excerpt: string;
	record_id?: string;
}

/** Index every evidence id in the manifest (cells, rows, text blocks). */
export function evidenceIndex(m: SourceManifest): Map<string, EvidenceEntry> {
	const out = new Map<string, EvidenceEntry>();
	for (const f of m.files) {
		for (const t of f.tables) {
			for (const r of t.rows) {
				const rowText = r.cells.map((c) => c.display ?? c.value ?? '').join(' | ');
				out.set(r.evidence_id, {
					evidence_id: r.evidence_id,
					file_index: f.index,
					kind: 'row',
					location: { file: f.name, table: t.label, row: r.row_number },
					excerpt: rowText.slice(0, 500),
					record_id: r.record_id
				});
				for (const c of r.cells) {
					const col = t.columns.find((x) => x.column_id === c.column_id);
					out.set(c.evidence_id, {
						evidence_id: c.evidence_id,
						file_index: f.index,
						kind: 'cell',
						location: {
							file: f.name,
							table: t.label,
							row: r.row_number,
							column: col?.label ?? c.column_id,
							cell: c.evidence_id.split('!').pop() ?? null
						},
						excerpt: (c.display ?? c.value ?? '').slice(0, 500),
						record_id: r.record_id
					});
				}
			}
		}
		for (const b of f.texts) {
			out.set(b.evidence_id, {
				evidence_id: b.evidence_id,
				file_index: f.index,
				kind: b.kind,
				location: { file: f.name, ...b.location },
				excerpt: b.text.slice(0, 500)
			});
		}
	}
	return out;
}
