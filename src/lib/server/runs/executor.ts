import { and, eq, inArray, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db, schema, type DbOrTx } from '../db';
import { config } from '../config';
import { AppError, isAppError, redact, type ErrorCode } from '../errors';
import { hashJson } from '../crypto';
import { appendEvent } from './events';
import { advanceReviewer } from './service';
import { captureSources, loadFrozenManifest, versionSummary } from '../sources/capture';
import { checkResult, compareResults, expectedFor, tableFor, type CheckFailure, type CheckReport } from '../checks/verify';
import { analysisPrompt, reviewPrompt, MAX_PROMPT_CHARS } from '../cli/prompts';
import { cliRunner, toErrorCode, type RunnerResult } from '../cli/client';
import {
	AnalysisResultSchema,
	ReviewOutputSchema,
	jsonSchemaOf,
	type AnalysisResult,
	type Difference,
	type Provider,
	type ReviewOutput
} from '../../shared/protocol';
import { evidenceIndex, type SourceManifest } from '../../shared/manifest';
import { TaskPlanSchema, type TaskPlan } from '../../shared/plan';
import { localDate } from '../schedule/rules';
import { ensureActiveRoot, generatedName, readRetained, runRelativeDir, writeFileAtomic } from '../storage';
import { generateArtifacts, type ArtifactInput, type ResultTable } from '../artifacts/generate';
import { enqueueNotifications } from '../notify/outbox';
import type { RunState } from '../db/schema';

type Run = typeof schema.runs.$inferSelect;

const ANALYSIS_SCHEMA = stripMeta(jsonSchemaOf(AnalysisResultSchema));
const REVIEW_SCHEMA = stripMeta(jsonSchemaOf(ReviewOutputSchema));

function stripMeta(s: Record<string, unknown>) {
	const { $schema: _s, ...rest } = s;
	void _s;
	return rest;
}

export class RunAborted extends Error {
	constructor(public reason: 'cancelled' | 'timeout' | 'shutdown') {
		super(reason);
	}
}

export interface ExecContext {
	signal: AbortSignal;
	abortReason: () => 'cancelled' | 'timeout' | 'shutdown' | null;
}

async function setState(run: Run, state: RunState, extra: Partial<Run> = {}, data: Record<string, unknown> = {}) {
	await db().transaction(async (tx) => {
		await tx
			.update(schema.runs)
			.set({ state, ...extra, updatedAt: new Date() })
			.where(eq(schema.runs.id, run.id));
		await appendEvent(tx, run, `state:${state}`, data);
	});
	Object.assign(run, { state, ...extra });
}

function link(run: Run) {
	return `${config().publicOrigin}/runs/${run.id}`;
}

function assertNotAborted(ctx: ExecContext) {
	const r = ctx.abortReason();
	if (r) throw new RunAborted(r);
}

/** One CLI call with a persistent (run, round, provider, role) claim. */
async function callCli(
	run: Run,
	provider: Provider,
	role: 'analysis' | 'review',
	prompt: string,
	schemaObj: object,
	signal: AbortSignal
): Promise<{ output: unknown; meta: RunnerResult }> {
	const inputHash = createHash('sha256').update(prompt).digest('hex');
	const inserted = await db()
		.insert(schema.cliExecutions)
		.values({ runId: run.id, round: run.round, provider, role, inputHash })
		.onConflictDoNothing()
		.returning();
	if (!inserted[0]) {
		// Already claimed by an earlier attempt: never execute the same CLI step twice.
		throw new AppError('INTERRUPTED', `${provider} ${role} 단계가 이미 실행된 기록이 있어 중복 실행하지 않음`, 'executing');
	}
	const execId = inserted[0].id;
	await db().transaction((tx) => appendEvent(tx, run, 'cli_started', { provider, role, round: run.round }));
	let meta: RunnerResult;
	try {
		meta = await cliRunner().invoke({
			id: `${run.id}:${run.round}:${provider}:${role}`,
			provider,
			prompt,
			schema: schemaObj,
			timeoutSeconds: config().cliStageTimeoutSeconds,
			signal
		});
	} catch (e) {
		const code: ErrorCode = isAppError(e) ? e.code : 'EXECUTION_FAILED';
		await db()
			.update(schema.cliExecutions)
			.set({
				status: code === 'INTERRUPTED' ? 'interrupted' : 'failed',
				errorCode: code,
				errorMessage: redact((e as Error).message),
				finishedAt: new Date()
			})
			.where(eq(schema.cliExecutions.id, execId));
		throw e;
	}
	const status = meta.status === 'succeeded' ? 'succeeded' : meta.status === 'cancelled' ? 'cancelled' : 'failed';
	await db()
		.update(schema.cliExecutions)
		.set({
			status,
			result: meta.status === 'succeeded' ? (meta.output as object) : null,
			errorCode: meta.error_code ?? null,
			errorMessage: meta.error_message ? redact(meta.error_message) : null,
			exitCode: meta.exit_code,
			cliVersion: meta.cli_version ?? null,
			model: meta.model ?? null,
			usage: {
				...(typeof meta.usage === 'object' && meta.usage ? meta.usage : {}),
				duration_ms: meta.duration_ms,
				tool_events: meta.tool_events
			},
			finishedAt: new Date()
		})
		.where(eq(schema.cliExecutions.id, execId));
	await db().transaction((tx) =>
		appendEvent(tx, run, 'cli_finished', { provider, role, round: run.round, status, error_code: meta.error_code ?? null })
	);
	if (meta.status === 'cancelled') throw new RunAborted('cancelled');
	if (meta.status !== 'succeeded')
		throw new AppError(
			toErrorCode(meta.error_code),
			`${provider}: ${redact(meta.error_message ?? 'failed')}`,
			role === 'analysis' ? 'executing' : 'comparing'
		);
	return { output: meta.output, meta };
}

function validateAnalysis(run: Run, provider: Provider, output: unknown): AnalysisResult {
	const parsed = AnalysisResultSchema.safeParse(output);
	if (!parsed.success)
		throw new AppError('OUTPUT_SCHEMA_INVALID', `${provider} 출력이 계약 schema와 다름`, 'executing', parsed.error.issues.slice(0, 5));
	const r = parsed.data;
	if (r.run_id !== run.id || r.round !== run.round || r.provider !== provider) {
		throw new AppError('OUTPUT_SCHEMA_INVALID', `${provider} 출력의 run/round/provider 식별자가 다름`, 'executing');
	}
	return r;
}

function validateReview(run: Run, reviewer: Provider, output: unknown): ReviewOutput {
	const parsed = ReviewOutputSchema.safeParse(output);
	if (!parsed.success)
		throw new AppError('OUTPUT_SCHEMA_INVALID', `${reviewer} 대조 출력이 schema와 다름`, 'comparing', parsed.error.issues.slice(0, 5));
	const r = parsed.data;
	if (r.run_id !== run.id || r.round !== run.round || r.reviewer !== reviewer || r.manifest_hash !== run.manifestHash) {
		throw new AppError('OUTPUT_SCHEMA_INVALID', '대조 출력의 식별자가 다름', 'comparing');
	}
	return r;
}

/** Run both independent analyses in parallel; the first failure terminates the sibling. */
async function runPair(run: Run, prompts: Record<Provider, string>, ctx: ExecContext) {
	const sibling = new AbortController();
	const onAbort = () => sibling.abort();
	ctx.signal.addEventListener('abort', onAbort, { once: true });
	const results: Partial<Record<Provider, AnalysisResult>> = {};
	let firstError: unknown;
	await Promise.allSettled(
		(['claude', 'codex'] as Provider[]).map(async (p) => {
			try {
				const { output } = await callCli(run, p, 'analysis', prompts[p], ANALYSIS_SCHEMA, sibling.signal);
				results[p] = validateAnalysis(run, p, output);
			} catch (e) {
				firstError ??= e;
				sibling.abort();
			}
		})
	);
	ctx.signal.removeEventListener('abort', onAbort);
	if (firstError) {
		if (firstError instanceof RunAborted || ctx.abortReason()) throw new RunAborted(ctx.abortReason() ?? 'cancelled');
		throw firstError;
	}
	return results as Record<Provider, AnalysisResult>;
}

export async function executeRun(runId: string, ctx: ExecContext): Promise<void> {
	const [loaded] = await db().select().from(schema.runs).where(eq(schema.runs.id, runId)).limit(1);
	if (!loaded) return;
	const run = loaded;
	const parsedPlan = TaskPlanSchema.safeParse(run.plan);
	if (!parsedPlan.success) {
		await handleFailure(
			run,
			new AppError('INPUT_REQUIRED', '저장된 업무 계획이 현재 형식과 맞지 않음 — 업무 설정을 다시 확인하세요', 'preparing'),
			ctx,
			{ results: {} }
		);
		return;
	}
	const plan = parsedPlan.data;
	let manifest: SourceManifest | undefined;
	let results: Partial<Record<Provider, AnalysisResult>> = {};
	let checks: CheckReport | undefined;
	try {
		let referenceDate = run.referenceDate;
		if (run.round === 1) {
			referenceDate = localDate(new Date(), plan.date_policy.timezone);
			await setState(run, 'preparing', { referenceDate }, { reference_date: referenceDate });
			const cap = await captureSources(run);
			manifest = cap.manifest;
			await db()
				.update(schema.runs)
				.set({ manifestHash: cap.hash, manifest: cap.summary as object, updatedAt: new Date() })
				.where(eq(schema.runs.id, run.id));
			run.manifestHash = cap.hash;
			run.manifest = cap.summary as object;
			await db().transaction((tx) => appendEvent(tx, run, 'sources_captured', { manifest_hash: cap.hash, files: plan.sources.length }));
		} else {
			// Review round: the original captured version, never a refreshed one.
			manifest = await loadFrozenManifest(run);
		}
		assertNotAborted(ctx);
		checks = expectedFor(plan, manifest, referenceDate!);
		const prompts = {} as Record<Provider, string>;
		for (const p of ['claude', 'codex'] as Provider[]) {
			prompts[p] = analysisPrompt({
				runId: run.id,
				round: run.round,
				provider: p,
				plan,
				manifest,
				manifestHash: run.manifestHash!,
				referenceDate: referenceDate!,
				expected: checks.expected,
				reviewFeedback: run.round === 2
			});
			if (prompts[p].length > MAX_PROMPT_CHARS)
				throw new AppError('SOURCE_TOO_LARGE', '자료가 CLI 입력 한도를 넘음 — 범위(시트/파일)를 줄이세요 (자르지 않음)', 'preparing');
		}
		await setState(run, 'executing', {}, { round: run.round });
		results = await runPair(run, prompts, ctx);
		assertNotAborted(ctx);

		await setState(run, 'comparing', {}, { reviewer: run.reviewerProvider });
		const failures: CheckFailure[] = [];
		for (const p of ['claude', 'codex'] as Provider[])
			failures.push(...checkResult(plan, manifest, run.manifestHash!, results[p]!, checks));
		const codeDiffs = compareResults(results.claude!, results.codex!, plan);
		if (failures.length || codeDiffs.length) {
			// Code verification is authoritative: no reviewer call can turn this into agreement.
			await recordDisagreement(run, manifest, results as Record<Provider, AnalysisResult>, checks, failures, codeDiffs, null);
			return;
		}
		const reviewer = (run.reviewerProvider ?? 'claude') as Provider;
		const { output } = await callCli(
			run,
			reviewer,
			'review',
			reviewPrompt({
				runId: run.id,
				round: run.round,
				reviewer,
				plan,
				manifestHash: run.manifestHash!,
				claude: results.claude!,
				codex: results.codex!,
				codeDifferences: []
			}),
			REVIEW_SCHEMA,
			ctx.signal
		);
		const review = validateReview(run, reviewer, output);
		assertNotAborted(ctx);
		if (review.verdict === 'disagree' || !review.final_summary) {
			await recordDisagreement(run, manifest, results as Record<Provider, AnalysisResult>, checks, [], review.differences, review);
			return;
		}
		await setState(run, 'finalizing');
		await finalize(run, plan, manifest, results as Record<Provider, AnalysisResult>, checks, review, ctx);
	} catch (e) {
		await handleFailure(run, e, ctx, { manifest, results, checks });
	}
}

function referencedEvidence(results: AnalysisResult[]): Set<string> {
	const ids = new Set<string>();
	for (const r of results) {
		r.claims.forEach((c) => c.evidence_ids.forEach((i) => ids.add(i)));
		r.records.forEach((x) => x.evidence_ids.forEach((i) => ids.add(i)));
	}
	return ids;
}

async function insertEvidence(tx: DbOrTx, run: Run, manifest: SourceManifest, ids: Iterable<string>, extraRecordIds: string[] = []) {
	const idx = evidenceIndex(manifest);
	const wanted = new Set(ids);
	// Rows of final records keep their row-level evidence for the panel.
	for (const f of manifest.files)
		for (const t of f.tables) for (const r of t.rows) if (extraRecordIds.includes(r.record_id)) wanted.add(r.evidence_id);
	const rows = [...wanted]
		.map((id) => idx.get(id))
		.filter((e): e is NonNullable<typeof e> => Boolean(e))
		.map((e) => ({
			runId: run.id,
			ownerId: run.ownerId,
			snapshotId: manifest.files[e.file_index]!.snapshot_id,
			evidenceKey: e.evidence_id,
			kind: e.kind,
			location: { ...e.location, record_id: e.record_id ?? null },
			excerpt: e.excerpt
		}));
	for (let i = 0; i < rows.length; i += 500) {
		await tx
			.insert(schema.evidence)
			.values(rows.slice(i, i + 500))
			.onConflictDoNothing();
	}
}

/** DB partial result + separate local JSON copy with its path recorded (A25/A26). */
async function retainPartial(run: Run, payload: Record<string, unknown>): Promise<string> {
	let fileOk = false;
	let dbOk = false;
	let written: Awaited<ReturnType<typeof writeFileAtomic>> | undefined;
	let rootId: string | undefined;
	try {
		const root = await ensureActiveRoot();
		rootId = root.id;
		written = await writeFileAtomic(root, runRelativeDir(run.ownerId, run.id, 'partial'), generatedName('json'), JSON.stringify(payload));
		fileOk = true;
	} catch (e) {
		console.error('[executor] partial file copy failed', redact((e as Error).message));
	}
	try {
		if (written && rootId) {
			await db()
				.insert(schema.retainedCopies)
				.values({
					runId: run.id,
					ownerId: run.ownerId,
					kind: 'partial',
					storageRootId: rootId,
					relativePath: written.relativePath,
					sha256: written.sha256,
					data: payload
				});
		}
		dbOk = true;
	} catch (e) {
		console.error('[executor] partial DB copy failed', redact((e as Error).message));
	}
	return fileOk && dbOk ? 'retained' : fileOk ? 'file_only' : dbOk ? 'db_only' : 'retention_failed';
}

async function recordDisagreement(
	run: Run,
	manifest: SourceManifest,
	results: Record<Provider, AnalysisResult>,
	checks: CheckReport,
	failures: CheckFailure[],
	differences: Difference[],
	review: ReviewOutput | null
) {
	const retention = await retainPartial(run, {
		kind: 'disagreement',
		round: run.round,
		results,
		failures,
		differences,
		review,
		warnings: checks.warnings
	});
	const second = run.round === 2;
	await db().transaction(async (tx) => {
		await tx.insert(schema.comparisons).values({
			runId: run.id,
			round: run.round,
			reviewer: review ? run.reviewerProvider : null,
			manifestHash: run.manifestHash!,
			verdict: 'disagree',
			checks: {
				failures,
				warnings: checks.warnings,
				expected: checks.expected.map((e) => ({
					index: e.index,
					type: e.type,
					count: e.recordIds?.length ?? null,
					value: e.value ?? null,
					window: e.window ?? null
				}))
			},
			differences,
			final: null
		});
		await insertEvidence(tx, run, manifest, referencedEvidence(Object.values(results)));
		const state: RunState = second ? 'disagreed' : 'awaiting_review';
		await tx
			.update(schema.runs)
			.set({ state, retentionStatus: retention, finishedAt: second ? new Date() : null, updatedAt: new Date() })
			.where(eq(schema.runs.id, run.id));
		await appendEvent(tx, run, `state:${state}`, { round: run.round, failures: failures.length, differences: differences.length });
		await enqueueNotifications(tx, {
			ownerId: run.ownerId,
			runId: run.id,
			taskId: run.taskId,
			event: second ? 'disagreed' : 'review_needed',
			severity: 'error',
			title: second ? '재검토 후에도 결과 불일치' : '결과 불일치 — 검토 필요',
			body: second
				? '두 실행 결과가 재검토 후에도 일치하지 않았습니다. 웹에서 차이를 확인하세요.'
				: '두 실행 결과가 일치하지 않습니다. 차이를 확인하고 재검토 여부를 선택하세요.',
			link: link(run)
		});
	});
}

const RETRYABLE_SHAPE: ErrorCode[] = [];
void RETRYABLE_SHAPE;

async function handleFailure(
	run: Run,
	e: unknown,
	ctx: ExecContext,
	partial: { manifest?: SourceManifest; results: Partial<Record<Provider, AnalysisResult>>; checks?: CheckReport }
) {
	let state: RunState = 'failed';
	let code: ErrorCode = 'EXECUTION_FAILED';
	let message = 'execution failed';
	if (e instanceof RunAborted) {
		state = e.reason === 'cancelled' ? 'cancelled' : e.reason === 'shutdown' ? 'interrupted' : 'failed';
		code = e.reason === 'cancelled' ? 'CANCELLED' : e.reason === 'shutdown' ? 'INTERRUPTED' : 'TIMEOUT';
		message = e.reason === 'timeout' ? '작업 전체 제한 시간 초과' : e.reason;
	} else if (isAppError(e)) {
		code = e.code;
		message = e.message;
		if (code === 'INTERRUPTED') state = 'interrupted';
		if (code === 'CANCELLED') state = 'cancelled';
	} else {
		message = (e as Error)?.message ?? String(e);
	}
	console.error(`[executor] run ${run.id} -> ${state} (${code})`, redact(message));
	const retention = await retainPartial(run, {
		kind: 'error',
		round: run.round,
		error: { code, message: redact(message), stage: run.state },
		results: partial.results,
		warnings: partial.checks?.warnings ?? []
	});
	try {
		await db().transaction(async (tx) => {
			const [u] = await tx
				.update(schema.runs)
				.set({
					state,
					errorCode: code,
					errorStage: run.state,
					errorMessage: redact(message),
					retentionStatus: retention,
					finishedAt: new Date(),
					leaseOwner: null,
					leaseExpiresAt: null,
					updatedAt: new Date()
				})
				.where(and(eq(schema.runs.id, run.id), inArray(schema.runs.state, ['preparing', 'executing', 'comparing', 'finalizing'])))
				.returning();
			if (!u) return;
			if (partial.manifest)
				await insertEvidence(
					tx,
					run,
					partial.manifest,
					referencedEvidence(Object.values(partial.results).filter(Boolean) as AnalysisResult[])
				);
			await appendEvent(tx, run, `state:${state}`, { error_code: code, stage: run.state });
			if (state !== 'cancelled') {
				await enqueueNotifications(tx, {
					ownerId: run.ownerId,
					runId: run.id,
					taskId: run.taskId,
					event: 'error',
					severity: 'error',
					title: '업무 실행 오류',
					body: `실행이 중단되었습니다 (${code}, 단계: ${run.state}). 자동 재시도하지 않습니다. 원본과 부분 결과는 보관되었습니다.`,
					link: link(run)
				});
			}
		});
	} catch (dbErr) {
		console.error('[executor] could not record failure state (DB unavailable?)', redact((dbErr as Error).message));
	}
	void ctx;
}

function resultTableFor(plan: TaskPlan, manifest: SourceManifest, opIndex: number, recordIds: string[]): ResultTable {
	const op = plan.operations[opIndex] as Extract<TaskPlan['operations'][number], { type: 'filter_rows' }>;
	const table = tableFor(manifest, plan, op.source_index);
	const keep = new Set(recordIds);
	return {
		columns: table.columns.map((c) => ({ column_id: c.column_id, label: c.label })),
		rows: table.rows
			.filter((r) => keep.has(r.record_id))
			.map((r) => ({
				record_id: r.record_id,
				cells: Object.fromEntries(r.cells.map((c) => [c.column_id, { type: c.type, value: c.value, display: c.display }]))
			}))
	};
}

async function finalize(
	run: Run,
	plan: TaskPlan,
	manifest: SourceManifest,
	results: Record<Provider, AnalysisResult>,
	checks: CheckReport,
	review: ReviewOutput,
	ctx: ExecContext
) {
	const root = await ensureActiveRoot();
	const tables = checks.expected
		.filter((e) => e.type === 'filter_rows')
		.map((e) => ({ operation_index: e.index, window: e.window ?? null, ...resultTableFor(plan, manifest, e.index, e.recordIds ?? []) }));
	const claims = results[(run.reviewerProvider as Provider) ?? 'claude'].claims;
	const recordCount = tables.reduce((n, t) => n + t.rows.length, 0);
	const zeroResult = tables.length > 0 && recordCount === 0;
	const warnings = [...checks.warnings, ...manifest.files.flatMap((f) => f.warnings.map((w) => `${f.name}: ${w}`))];
	const answer = {
		summary: review.final_summary,
		claims,
		tables,
		warnings,
		uncertainties: [...new Set([...results.claude.uncertainties, ...results.codex.uncertainties, ...review.uncertainties])],
		reviewer: run.reviewerProvider,
		round: run.round,
		reference_date: run.referenceDate,
		late: run.late,
		zero_result: zeroResult
	};
	const versionInfo = versionSummary(manifest, run.manifestHash!);

	// Generated copies (never the original) — each validated by reopening.
	const artifactInput: ArtifactInput = {
		title: plan.title,
		summary: review.final_summary ?? '',
		claims: claims.map((c) => ({ claim_key: c.claim_key, value: c.value.value, type: c.value.type, unit: c.unit })),
		table: tables[0] ? { columns: tables[0].columns, rows: tables[0].rows } : null,
		versionInfo: manifest.files.map((f) => ({
			name: f.name,
			sha256: f.sha256,
			provider_revision: f.provider_revision,
			captured_at: f.captured_at
		})),
		warnings,
		csvEncoding: plan.outputs.csv_encoding
	};
	const generated = plan.outputs.downloads.length ? await generateArtifacts(artifactInput, plan.outputs.downloads) : [];
	assertNotAborted(ctx);
	const artifactRows: (typeof schema.artifacts.$inferInsert)[] = [];
	for (const g of generated) {
		const w = await writeFileAtomic(
			root,
			runRelativeDir(run.ownerId, run.id, 'artifacts'),
			generatedName(g.format === 'jpeg' ? 'jpg' : g.format),
			g.bytes
		);
		let previewPath: string | null = null;
		if (g.validation.previewPng) {
			previewPath = (
				await writeFileAtomic(root, runRelativeDir(run.ownerId, run.id, 'artifacts'), generatedName('png'), g.validation.previewPng)
			).relativePath;
		}
		artifactRows.push({
			runId: run.id,
			ownerId: run.ownerId,
			storageRootId: root.id,
			relativePath: w.relativePath,
			mimeType: g.mimeType,
			filename: g.filename,
			format: g.format,
			sizeBytes: w.sizeBytes,
			sha256: w.sha256,
			validation: { ...g.validation, previewPng: undefined, preview_path: previewPath }
		});
	}
	// Prove the captured originals were not modified by processing.
	const snaps = await db().select().from(schema.sourceSnapshots).where(eq(schema.sourceSnapshots.runId, run.id));
	for (const s of snaps) {
		const buf = await readRetained(s.storageRootId, s.relativePath);
		if (createHash('sha256').update(buf).digest('hex') !== s.sha256)
			throw new AppError('STORAGE_FAILED', '원본 스냅샷 hash가 변경됨', 'finalizing');
	}
	const resultFile = await writeFileAtomic(
		root,
		runRelativeDir(run.ownerId, run.id, 'results'),
		generatedName('json'),
		JSON.stringify({ answer, version: versionInfo })
	);

	await db().transaction(async (tx) => {
		const cancel = await tx.execute<{ cancel_requested_at: Date | null; state: string }>(
			sql`select cancel_requested_at, state from runs where id = ${run.id} for update`
		);
		if (cancel.rows[0]?.cancel_requested_at || cancel.rows[0]?.state !== 'finalizing') throw new RunAborted('cancelled');
		await tx.insert(schema.comparisons).values({
			runId: run.id,
			round: run.round,
			reviewer: run.reviewerProvider,
			manifestHash: run.manifestHash!,
			verdict: 'agree',
			checks: {
				failures: [],
				warnings: checks.warnings,
				expected: checks.expected.map((e) => ({
					index: e.index,
					type: e.type,
					count: e.recordIds?.length ?? null,
					value: e.value ?? null,
					window: e.window ?? null
				}))
			},
			differences: [],
			final: { summary: review.final_summary, input_hash: hashJson(answer) }
		});
		await tx.insert(schema.results).values({ runId: run.id, ownerId: run.ownerId, answer, versionInfo, recordCount });
		if (artifactRows.length) await tx.insert(schema.artifacts).values(artifactRows);
		await tx
			.insert(schema.retainedCopies)
			.values({
				runId: run.id,
				ownerId: run.ownerId,
				kind: 'result',
				storageRootId: root.id,
				relativePath: resultFile.relativePath,
				sha256: resultFile.sha256,
				data: null
			});
		await insertEvidence(
			tx,
			run,
			manifest,
			referencedEvidence([results.claude, results.codex]),
			tables.flatMap((t) => t.rows.map((r) => r.record_id))
		);
		await advanceReviewer(tx, run.ownerId, run.id, run.reviewerProvider as Provider);
		await tx
			.update(schema.runs)
			.set({
				state: 'completed',
				finishedAt: new Date(),
				leaseOwner: null,
				leaseExpiresAt: null,
				retentionStatus: 'completed',
				updatedAt: new Date()
			})
			.where(eq(schema.runs.id, run.id));
		await appendEvent(tx, run, 'state:completed', { records: recordCount, artifacts: artifactRows.length });
		for (const a of plan.external_actions) {
			const art = await tx
				.select()
				.from(schema.artifacts)
				.where(and(eq(schema.artifacts.runId, run.id), eq(schema.artifacts.format, a.format)))
				.limit(1);
			if (art[0]) {
				const destination = { label: a.destination_label };
				await tx
					.insert(schema.externalActions)
					.values({
						ownerId: run.ownerId,
						runId: run.id,
						artifactId: art[0].id,
						artifactSha256: art[0].sha256,
						action: 'drive_upload_copy',
						destination,
						destinationHash: hashJson(destination)
					});
			}
		}
		await enqueueNotifications(tx, {
			ownerId: run.ownerId,
			runId: run.id,
			taskId: run.taskId,
			event: zeroResult ? 'zero_result' : 'completed',
			severity: 'normal',
			title: zeroResult ? `${plan.title}: 해당 결과 0건` : `${plan.title}: 결과 준비됨`,
			body: zeroResult
				? '조건에 맞는 항목이 없습니다. 오늘 이 업무의 정상 알림을 끌 수 있습니다.'
				: `결과 ${recordCount}건이 준비되었습니다.`,
			link: link(run)
		});
		await tx.execute(sql`select pg_notify('snapshot_cleanup', ${run.id})`);
	});
}
