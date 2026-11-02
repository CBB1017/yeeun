import { z } from 'zod';

/** Structured outputs required from the CLIs. Unknown fields are rejected. */

export const TypedValueSchema = z.strictObject({
	type: z.enum(['number', 'date', 'string', 'boolean', 'count']),
	value: z.string()
});

export const ClaimSchema = z.strictObject({
	claim_key: z.string().regex(/^[a-z0-9_.:-]{1,64}$/),
	value: TypedValueSchema,
	unit: z.string().nullable(),
	evidence_ids: z.array(z.string()).min(1)
});
export type Claim = z.infer<typeof ClaimSchema>;

export const RecordRefSchema = z.strictObject({
	operation_index: z.number().int().min(0),
	source_record_id: z.string(),
	evidence_ids: z.array(z.string()).min(1)
});
export type RecordRef = z.infer<typeof RecordRefSchema>;

export const AnalysisResultSchema = z.strictObject({
	schema_version: z.literal(1),
	run_id: z.string(),
	round: z.number().int(),
	provider: z.enum(['claude', 'codex']),
	manifest_hash: z.string(),
	status: z.enum(['ok', 'unsupported', 'needs_input']),
	summary: z.string().max(20000),
	claims: z.array(ClaimSchema),
	records: z.array(RecordRefSchema),
	uncertainties: z.array(z.string())
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export const DifferenceSchema = z.strictObject({
	field: z.string(),
	claude_value: z.string().nullable(),
	codex_value: z.string().nullable(),
	reason: z.string()
});
export type Difference = z.infer<typeof DifferenceSchema>;

export const ReviewOutputSchema = z.strictObject({
	schema_version: z.literal(1),
	run_id: z.string(),
	round: z.number().int(),
	reviewer: z.enum(['claude', 'codex']),
	manifest_hash: z.string(),
	verdict: z.enum(['agree', 'disagree']),
	differences: z.array(DifferenceSchema),
	final_summary: z.string().nullable(),
	uncertainties: z.array(z.string())
});
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

/** Task-setup (authoring) output: only fields the code then validates & merges. */
export const AuthoringOutputSchema = z.strictObject({
	schema_version: z.literal(1),
	title: z.string(),
	goal: z.string(),
	operations_json: z.string(),
	questions: z.array(z.string()),
	limitations: z.array(z.string())
});
export type AuthoringOutput = z.infer<typeof AuthoringOutputSchema>;

export type Provider = 'claude' | 'codex';
export const PROVIDERS: Provider[] = ['claude', 'codex'];

export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
	return z.toJSONSchema(schema, { target: 'draft-7', io: 'output' }) as Record<string, unknown>;
}
