import { z } from 'zod';

/**
 * TaskPlan: the reviewable, user-confirmed description of a task.
 * Shared by server and UI. Operations are declarative; free text is never
 * turned into shell commands.
 */

export const OUTPUT_FORMATS = ['xlsx', 'pptx', 'pdf', 'csv', 'tsv', 'png', 'jpeg'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/);

export const PredicateSchema = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('all') }),
	z.strictObject({
		kind: z.literal('date_window'),
		/** Window starts at the run's reference date (inclusive) and spans `days` dates. */
		start: z.literal('reference_date'),
		days: z.number().int().min(1).max(3660)
	}),
	z.strictObject({ kind: z.literal('date_between'), from: isoDate, to: isoDate }),
	z.strictObject({ kind: z.literal('equals'), value: z.string().min(1) }),
	z.strictObject({ kind: z.literal('contains'), value: z.string().min(1) }),
	z.strictObject({
		kind: z.literal('number_between'),
		min: decimalString.nullable(),
		max: decimalString.nullable()
	})
]);
export type Predicate = z.infer<typeof PredicateSchema>;

export const OperationSchema = z.discriminatedUnion('type', [
	z.strictObject({
		type: z.literal('filter_rows'),
		source_index: z.number().int().min(0),
		column: z.string().min(1).nullable(),
		predicate: PredicateSchema
	}),
	z.strictObject({
		type: z.literal('aggregate'),
		source_index: z.number().int().min(0),
		column: z.string().min(1).nullable(),
		fn: z.enum(['count', 'sum', 'avg', 'min', 'max']),
		filter_column: z.string().min(1).nullable(),
		filter: PredicateSchema
	}),
	z.strictObject({
		type: z.literal('answer'),
		question: z.string().min(1).max(4000),
		/** Claim keys both executions must answer so they can be compared field by field. */
		claim_keys: z.array(z.string().regex(/^[a-z0-9_.:-]{1,64}$/)).max(50)
	})
]);
export type Operation = z.infer<typeof OperationSchema>;

export const SourceSelectorSchema = z.strictObject({
	sheet: z.string().nullable(),
	header_row: z.number().int().min(1).max(1000).nullable(),
	include_hidden_rows: z.boolean(),
	include_hidden_slides: z.boolean(),
	include_notes: z.boolean(),
	/** Input text encoding for CSV/TSV. CP949 is only used when the user selects it. */
	csv_encoding: z.enum(['utf-8', 'cp949'])
});
export type SourceSelector = z.infer<typeof SourceSelectorSchema>;

/** A Google Drive file the user explicitly allowed (file grant). */
export const DriveSourceSchema = z.strictObject({
	grant_id: z.uuid(),
	provider_file_id: z.string().min(1),
	name: z.string(),
	mime_type: z.string(),
	selector: SourceSelectorSchema
});

/** A file the user attached from their PC, kept as a retained original. */
export const UploadSourceSchema = z.strictObject({
	upload_id: z.uuid(),
	name: z.string(),
	mime_type: z.string(),
	selector: SourceSelectorSchema
});

export const PlanSourceSchema = z.union([DriveSourceSchema, UploadSourceSchema]);
export type PlanSource = z.infer<typeof PlanSourceSchema>;

/** Stable identity of a plan source (grant or upload id). */
export function sourceKey(s: PlanSource): string {
	return 'upload_id' in s ? `upload:${s.upload_id}` : `grant:${s.grant_id}`;
}

export const ScheduleRuleSchema = z.discriminatedUnion('kind', [
	z.strictObject({
		kind: z.literal('weekly'),
		/** ISO weekday numbers, 1 = Monday … 7 = Sunday. */
		weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
		times: z.array(hhmm).min(1).max(24)
	}),
	z.strictObject({ kind: z.literal('daily'), times: z.array(hhmm).min(1).max(24) })
]);
export type ScheduleRule = z.infer<typeof ScheduleRuleSchema>;

export const PlanScheduleSchema = z.discriminatedUnion('mode', [
	z.strictObject({ mode: z.literal('manual') }),
	z.strictObject({
		mode: z.literal('recurring'),
		raw_text: z.string(),
		rule: ScheduleRuleSchema,
		timezone: z.string().min(1),
		/** Holiday handling is only applied when the user asked for it. */
		holidays: z.strictObject({ exclude: z.literal(false) })
	})
]);

export const QuestionSchema = z.strictObject({
	key: z.string(),
	question: z.string(),
	options: z.array(z.strictObject({ value: z.string(), label: z.string() }))
});
export type PlanQuestion = z.infer<typeof QuestionSchema>;

export const TaskPlanSchema = z.strictObject({
	schema_version: z.literal(1),
	title: z.string().min(1).max(200),
	goal: z.string().min(1).max(4000),
	original_prompt: z.string().max(20000),
	sources: z.array(PlanSourceSchema).max(10),
	operations: z.array(OperationSchema).max(20),
	outputs: z.strictObject({
		web: z.literal(true),
		downloads: z.array(z.enum(OUTPUT_FORMATS)),
		csv_encoding: z.enum(['utf-8', 'utf-8-bom', 'cp949'])
	}),
	schedule: PlanScheduleSchema,
	date_policy: z.strictObject({
		reference: z.literal('run_start_date'),
		timezone: z.string().min(1)
	}),
	number_policy: z.strictObject({
		rounding: z.enum(['none', 'half_up']),
		digits: z.number().int().min(0).max(10)
	}),
	notifications: z.strictObject({ email: z.boolean(), push: z.boolean() }),
	external_actions: z.array(
		z.strictObject({
			action: z.literal('drive_upload_copy'),
			format: z.enum(OUTPUT_FORMATS),
			destination_label: z.string()
		})
	),
	unresolved_questions: z.array(QuestionSchema),
	limitations: z.array(z.string())
});
export type TaskPlan = z.infer<typeof TaskPlanSchema>;

export function emptyPlan(prompt: string, timezone: string): TaskPlan {
	return {
		schema_version: 1,
		title: prompt.slice(0, 60) || '새 업무',
		goal: prompt || '업무 목표를 입력하세요',
		original_prompt: prompt,
		sources: [],
		operations: [],
		outputs: { web: true, downloads: [], csv_encoding: 'utf-8' },
		schedule: { mode: 'manual' },
		date_policy: { reference: 'run_start_date', timezone },
		number_policy: { rounding: 'none', digits: 0 },
		notifications: { email: false, push: false },
		external_actions: [],
		unresolved_questions: [],
		limitations: []
	};
}

/** Human-readable window bounds for a date_window predicate (inclusive). */
export function windowLabel(days: number): string {
	return `시작일 포함 ${days}일 (시작일 ~ 시작일+${days - 1}일)`;
}

export function defaultSelector(): SourceSelector {
	return {
		sheet: null,
		header_row: null,
		include_hidden_rows: false,
		include_hidden_slides: false,
		include_notes: false,
		csv_encoding: 'utf-8'
	};
}
