import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { AppError } from '../errors';
import { getOwnedRun } from './service';
import { approvalHash } from '../external/actions';

/** Owner-scoped read models. Never expose host paths, prompts, tokens or raw CLI logs. */

export async function listRuns(ownerId: string, limit = 50) {
	const rows = await db()
		.select({ run: schema.runs, title: schema.tasks.title })
		.from(schema.runs)
		.innerJoin(schema.tasks, eq(schema.tasks.id, schema.runs.taskId))
		.where(eq(schema.runs.ownerId, ownerId))
		.orderBy(desc(schema.runs.createdAt))
		.limit(limit);
	return rows.map((r) => ({ ...publicRun(r.run), title: r.title }));
}

export function publicRun(r: typeof schema.runs.$inferSelect) {
	return {
		id: r.id,
		taskId: r.taskId,
		state: r.state,
		round: r.round,
		trigger: r.trigger,
		reviewer: r.reviewerProvider,
		referenceDate: r.referenceDate,
		late: r.late,
		manifestHash: r.manifestHash,
		version: r.manifest,
		errorCode: r.errorCode,
		errorStage: r.errorStage,
		errorMessage: r.errorMessage,
		retentionStatus: r.retentionStatus,
		cancelRequested: Boolean(r.cancelRequestedAt),
		reviewRequested: Boolean(r.reviewRequestedAt),
		createdAt: r.createdAt,
		startedAt: r.startedAt,
		finishedAt: r.finishedAt
	};
}

/** Why a queued run is waiting (lane held by own run awaiting review, or global slot). */
export async function waitingReason(run: typeof schema.runs.$inferSelect) {
	if (!['queued', 'review_queued'].includes(run.state)) return null;
	const blockers = await db()
		.select({ id: schema.runs.id, state: schema.runs.state })
		.from(schema.runs)
		.where(
			and(
				eq(schema.runs.ownerId, run.ownerId),
				inArray(schema.runs.state, ['preparing', 'executing', 'comparing', 'finalizing', 'awaiting_review', 'queued', 'review_queued']),
				sql`(${schema.runs.createdAt}, ${schema.runs.id}) < (${run.createdAt}, ${run.id})`
			)
		)
		.orderBy(asc(schema.runs.createdAt))
		.limit(1);
	if (blockers[0]) {
		return blockers[0].state === 'awaiting_review'
			? {
					kind: 'lane_review',
					blockingRunId: blockers[0].id,
					message: '이전 실행이 검토를 기다리고 있어 대기 중입니다. 검토하거나 취소하면 진행됩니다.'
				}
			: { kind: 'lane', blockingRunId: blockers[0].id, message: '이전 실행이 끝나면 시작됩니다.' };
	}
	return { kind: 'global', blockingRunId: null, message: '다른 업무가 실행 중이라 순서를 기다립니다.' };
}

export async function runDetail(ownerId: string, runId: string) {
	const run = await getOwnedRun(ownerId, runId);
	const [task] = await db()
		.select({ id: schema.tasks.id, title: schema.tasks.title })
		.from(schema.tasks)
		.where(eq(schema.tasks.id, run.taskId));
	const execs = await db()
		.select({
			round: schema.cliExecutions.round,
			provider: schema.cliExecutions.provider,
			role: schema.cliExecutions.role,
			status: schema.cliExecutions.status,
			errorCode: schema.cliExecutions.errorCode,
			errorMessage: schema.cliExecutions.errorMessage,
			inputHash: schema.cliExecutions.inputHash,
			cliVersion: schema.cliExecutions.cliVersion,
			model: schema.cliExecutions.model,
			usage: schema.cliExecutions.usage,
			startedAt: schema.cliExecutions.startedAt,
			finishedAt: schema.cliExecutions.finishedAt,
			result: schema.cliExecutions.result
		})
		.from(schema.cliExecutions)
		.where(eq(schema.cliExecutions.runId, run.id))
		.orderBy(asc(schema.cliExecutions.startedAt));
	const comps = await db()
		.select()
		.from(schema.comparisons)
		.where(eq(schema.comparisons.runId, run.id))
		.orderBy(asc(schema.comparisons.round));
	const events = await db()
		.select({ seq: schema.runEvents.seq, type: schema.runEvents.type, data: schema.runEvents.data, createdAt: schema.runEvents.createdAt })
		.from(schema.runEvents)
		.where(eq(schema.runEvents.runId, run.id))
		.orderBy(asc(schema.runEvents.seq));
	const snaps = await db()
		.select({
			id: schema.sourceSnapshots.id,
			name: schema.sourceSnapshots.name,
			providerRevision: schema.sourceSnapshots.providerRevision,
			capturedAt: schema.sourceSnapshots.capturedAt,
			sha256: schema.sourceSnapshots.sha256,
			status: schema.sourceSnapshots.status,
			deletedAt: schema.sourceSnapshots.deletedAt,
			providerFileId: schema.sourceSnapshots.providerFileId
		})
		.from(schema.sourceSnapshots)
		.where(eq(schema.sourceSnapshots.runId, run.id));
	const notes = await db()
		.select({
			id: schema.notifications.id,
			event: schema.notifications.event,
			channel: schema.notifications.channel,
			status: schema.notifications.status,
			lastError: schema.notifications.lastError,
			createdAt: schema.notifications.createdAt
		})
		.from(schema.notifications)
		.where(eq(schema.notifications.runId, run.id));
	const partial = await db()
		.select({
			id: schema.retainedCopies.id,
			kind: schema.retainedCopies.kind,
			sha256: schema.retainedCopies.sha256,
			createdAt: schema.retainedCopies.createdAt
		})
		.from(schema.retainedCopies)
		.where(and(eq(schema.retainedCopies.runId, run.id), inArray(schema.retainedCopies.kind, ['partial', 'result'])));
	return {
		run: publicRun(run),
		task,
		waiting: await waitingReason(run),
		executions: execs.map((e) => ({ ...e, result: e.role === 'analysis' || e.role === 'review' ? e.result : null })),
		comparisons: comps,
		events,
		snapshots: snaps,
		notifications: notes,
		retained: partial
	};
}

export async function runResult(ownerId: string, runId: string) {
	const run = await getOwnedRun(ownerId, runId);
	const [res] = await db().select().from(schema.results).where(eq(schema.results.runId, run.id)).limit(1);
	if (!res) throw new AppError('NOT_FOUND', '완료된 결과가 없음');
	const arts = await db()
		.select({
			id: schema.artifacts.id,
			filename: schema.artifacts.filename,
			format: schema.artifacts.format,
			mimeType: schema.artifacts.mimeType,
			sizeBytes: schema.artifacts.sizeBytes,
			sha256: schema.artifacts.sha256,
			validation: schema.artifacts.validation,
			createdAt: schema.artifacts.createdAt
		})
		.from(schema.artifacts)
		.where(eq(schema.artifacts.runId, run.id));
	const actions = await db().select().from(schema.externalActions).where(eq(schema.externalActions.runId, run.id));
	return {
		run: publicRun(run),
		answer: res.answer,
		version: res.versionInfo,
		recordCount: res.recordCount,
		artifacts: arts.map((a) => ({
			...a,
			validation: {
				...(a.validation as object),
				preview_path: undefined,
				has_preview: Boolean((a.validation as { preview_path?: string }).preview_path)
			}
		})),
		externalActions: actions.map((a) => ({
			id: a.id,
			action: a.action,
			destination: a.destination,
			status: a.status,
			artifactId: a.artifactId,
			artifactSha256: a.artifactSha256,
			approvalHash: approvalHash(a),
			executedAt: a.executedAt,
			lastError: a.lastError
		}))
	};
}

export async function runEvidence(ownerId: string, runId: string) {
	const run = await getOwnedRun(ownerId, runId);
	const ev = await db()
		.select({
			key: schema.evidence.evidenceKey,
			kind: schema.evidence.kind,
			location: schema.evidence.location,
			excerpt: schema.evidence.excerpt,
			snapshotId: schema.evidence.snapshotId
		})
		.from(schema.evidence)
		.where(eq(schema.evidence.runId, run.id))
		.limit(20_000);
	const snaps = await db()
		.select({
			id: schema.sourceSnapshots.id,
			name: schema.sourceSnapshots.name,
			providerFileId: schema.sourceSnapshots.providerFileId,
			providerRevision: schema.sourceSnapshots.providerRevision,
			providerModifiedAt: schema.sourceSnapshots.providerModifiedAt,
			capturedAt: schema.sourceSnapshots.capturedAt,
			sha256: schema.sourceSnapshots.sha256,
			status: schema.sourceSnapshots.status,
			deletedAt: schema.sourceSnapshots.deletedAt
		})
		.from(schema.sourceSnapshots)
		.where(eq(schema.sourceSnapshots.runId, run.id));
	const grants = await db()
		.select({ providerFileId: schema.fileGrants.providerFileId, webViewLink: schema.fileGrants.webViewLink })
		.from(schema.fileGrants)
		.where(eq(schema.fileGrants.ownerId, ownerId));
	return {
		evidence: ev,
		snapshots: snaps.map((s) => ({ ...s, driveLink: grants.find((g) => g.providerFileId === s.providerFileId)?.webViewLink ?? null })),
		note: '원본 Drive 링크는 현재 버전일 수 있으며 분석 당시 내용과 다를 수 있습니다.'
	};
}

export async function ownedArtifact(ownerId: string, id: string) {
	if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('NOT_FOUND', 'not found');
	const [a] = await db()
		.select()
		.from(schema.artifacts)
		.where(and(eq(schema.artifacts.id, id), eq(schema.artifacts.ownerId, ownerId)))
		.limit(1);
	if (!a) throw new AppError('NOT_FOUND', 'not found');
	return a;
}
