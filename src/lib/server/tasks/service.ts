import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { AppError } from '../errors';
import { TaskPlanSchema, sourceKey, type TaskPlan } from '../../shared/plan';
import { MAX_ATTACHMENTS } from '../../shared/uploads';
import { ownedActiveUploads } from '../uploads/service';
import { interpret, remainingQuestions } from '../plan/interpret';
import { isValidZone, nextOccurrence, nextOccurrences } from '../schedule/rules';

/** Task drafts -> confirmed tasks (+ schedules). Everything is owner-scoped. */

export async function activeGrants(ownerId: string) {
	return db()
		.select()
		.from(schema.fileGrants)
		.where(and(eq(schema.fileGrants.ownerId, ownerId), eq(schema.fileGrants.status, 'active')))
		.orderBy(desc(schema.fileGrants.createdAt));
}

export async function createDraft(ownerId: string, prompt: string, timezone: string, uploadIds: string[] = []) {
	if (!isValidZone(timezone)) throw new AppError('VALIDATION_FAILED', '알 수 없는 시간대');
	if (uploadIds.length > MAX_ATTACHMENTS) throw new AppError('VALIDATION_FAILED', `첨부 파일은 최대 ${MAX_ATTACHMENTS}개까지 사용할 수 있습니다`);
	const uploads = await ownedActiveUploads(ownerId, uploadIds);
	const grants = await activeGrants(ownerId);
	const plan = interpret(prompt, grants, timezone, uploads);
	const [d] = await db()
		.insert(schema.taskDrafts)
		.values({ ownerId, originalPrompt: prompt, plan, status: plan.unresolved_questions.length ? 'needs_input' : 'ready' })
		.returning();
	return d!;
}

export async function getDraft(ownerId: string, id: string) {
	if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('NOT_FOUND', 'not found');
	const [d] = await db()
		.select()
		.from(schema.taskDrafts)
		.where(and(eq(schema.taskDrafts.id, id), eq(schema.taskDrafts.ownerId, ownerId)))
		.limit(1);
	if (!d) throw new AppError('NOT_FOUND', 'not found');
	return d;
}

/** Server-side validation of an edited plan: sources must be the user's active grants or uploads. */
async function validatePlan(ownerId: string, plan: TaskPlan) {
	const keys = plan.sources.map(sourceKey);
	if (new Set(keys).size !== keys.length) throw new AppError('VALIDATION_FAILED', '같은 파일이 두 번 선택됨');
	const ids = plan.sources.flatMap((s) => ('grant_id' in s ? [s.grant_id] : []));
	if (ids.length) {
		const grants = await db()
			.select()
			.from(schema.fileGrants)
			.where(and(eq(schema.fileGrants.ownerId, ownerId), eq(schema.fileGrants.status, 'active'), inArray(schema.fileGrants.id, ids)));
		for (const s of plan.sources) {
			if (!('grant_id' in s)) continue;
			const g = grants.find((x) => x.id === s.grant_id);
			if (!g || g.providerFileId !== s.provider_file_id) throw new AppError('VALIDATION_FAILED', '허용되지 않은 파일이 포함됨');
			s.name = g.name;
			s.mime_type = g.mimeType;
		}
	}
	const uploadIds = plan.sources.flatMap((s) => ('upload_id' in s ? [s.upload_id] : []));
	const uploads = await ownedActiveUploads(ownerId, uploadIds);
	for (const s of plan.sources) {
		if (!('upload_id' in s)) continue;
		const u = uploads.find((x) => x.id === s.upload_id)!;
		s.name = u.displayName;
		s.mime_type = u.mimeType;
	}
	if (plan.schedule.mode === 'recurring' && !isValidZone(plan.schedule.timezone))
		throw new AppError('VALIDATION_FAILED', '알 수 없는 시간대');
	if (!isValidZone(plan.date_policy.timezone)) throw new AppError('VALIDATION_FAILED', '알 수 없는 시간대');
}

export async function updateDraft(ownerId: string, id: string, expectedRevision: number, rawPlan: unknown, confirmedTimezone: boolean) {
	const parsed = TaskPlanSchema.safeParse(rawPlan);
	if (!parsed.success)
		throw new AppError(
			'VALIDATION_FAILED',
			'계획 형식 오류',
			null,
			parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message }))
		);
	const plan = parsed.data;
	await validatePlan(ownerId, plan);
	plan.unresolved_questions = remainingQuestions(plan, confirmedTimezone);
	const [d] = await db()
		.update(schema.taskDrafts)
		.set({
			plan,
			revision: sql`${schema.taskDrafts.revision} + 1`,
			status: plan.unresolved_questions.length ? 'needs_input' : 'ready',
			updatedAt: new Date()
		})
		.where(
			and(
				eq(schema.taskDrafts.id, id),
				eq(schema.taskDrafts.ownerId, ownerId),
				eq(schema.taskDrafts.revision, expectedRevision),
				inArray(schema.taskDrafts.status, ['draft', 'needs_input', 'ready'])
			)
		)
		.returning();
	if (!d) throw new AppError('CONFLICT', '다른 곳에서 계획이 변경됨 — 새로고침 후 다시 확인하세요');
	return d;
}

/** Activation only after the user confirms the exact revision they reviewed. */
export async function confirmDraft(ownerId: string, id: string, revision: number) {
	return db().transaction(async (tx) => {
		const [d] = await tx
			.select()
			.from(schema.taskDrafts)
			.where(and(eq(schema.taskDrafts.id, id), eq(schema.taskDrafts.ownerId, ownerId)))
			.limit(1)
			.for('update');
		if (!d) throw new AppError('NOT_FOUND', 'not found');
		if (d.status === 'confirmed' && d.confirmedTaskId) return { taskId: d.confirmedTaskId, duplicate: true };
		if (d.revision !== revision) throw new AppError('CONFLICT', '확인한 계획 버전이 최신이 아님');
		const plan = TaskPlanSchema.parse(d.plan);
		// Attached originals must still exist (the user may have deleted one after drafting).
		await ownedActiveUploads(
			ownerId,
			plan.sources.flatMap((s) => ('upload_id' in s ? [s.upload_id] : []))
		);
		if (d.status !== 'ready' || plan.unresolved_questions.length) throw new AppError('INPUT_REQUIRED', '남은 질문을 먼저 해결하세요');
		if (plan.limitations.some((l) => l.startsWith('UNSUPPORTED:')))
			throw new AppError('INPUT_REQUIRED', '지원하지 않는 작업이 포함되어 활성화할 수 없음');
		const now = new Date();
		const [task] = await tx
			.insert(schema.tasks)
			.values({ ownerId, draftId: d.id, title: plan.title, plan, planRevision: d.revision, confirmedAt: now })
			.returning();
		for (const [i, s] of plan.sources.entries()) {
			await tx
				.insert(schema.taskSources)
				.values(
					'upload_id' in s
						? { taskId: task!.id, ownerId, uploadId: s.upload_id, providerFileId: s.upload_id, selector: s.selector, position: i }
						: { taskId: task!.id, ownerId, grantId: s.grant_id, providerFileId: s.provider_file_id, selector: s.selector, position: i }
				);
		}
		if (plan.schedule.mode === 'recurring') {
			await tx.insert(schema.schedules).values({
				taskId: task!.id,
				ownerId,
				revision: 1,
				rule: plan.schedule.rule,
				timezone: plan.schedule.timezone,
				watermarkAt: now,
				nextDueAt: nextOccurrence(plan.schedule.rule, plan.schedule.timezone, now)
			});
		}
		await tx
			.update(schema.taskDrafts)
			.set({ status: 'confirmed', confirmedTaskId: task!.id, updatedAt: now })
			.where(eq(schema.taskDrafts.id, d.id));
		return { taskId: task!.id, duplicate: false };
	});
}

export async function listTasks(ownerId: string) {
	const tasks = await db().select().from(schema.tasks).where(eq(schema.tasks.ownerId, ownerId)).orderBy(desc(schema.tasks.createdAt));
	const scheds = await db().select().from(schema.schedules).where(eq(schema.schedules.ownerId, ownerId));
	return tasks.map((t) => ({ ...t, schedule: scheds.find((s) => s.taskId === t.id) ?? null }));
}

export async function getTask(ownerId: string, id: string) {
	if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('NOT_FOUND', 'not found');
	const [t] = await db()
		.select()
		.from(schema.tasks)
		.where(and(eq(schema.tasks.id, id), eq(schema.tasks.ownerId, ownerId)))
		.limit(1);
	if (!t) throw new AppError('NOT_FOUND', 'not found');
	const [s] = await db().select().from(schema.schedules).where(eq(schema.schedules.taskId, id)).limit(1);
	const plan = t.plan as TaskPlan;
	const upcoming =
		s && s.active && plan.schedule.mode === 'recurring' ? nextOccurrences(plan.schedule.rule, s.timezone, new Date(), 3) : [];
	return { task: t, schedule: s ?? null, upcoming };
}

/** Pause/resume. Resuming moves the watermark to now: no catch-up for a paused period. */
export async function setTaskStatus(ownerId: string, id: string, status: 'active' | 'paused' | 'archived') {
	return db().transaction(async (tx) => {
		const [t] = await tx
			.update(schema.tasks)
			.set({ status, updatedAt: new Date() })
			.where(and(eq(schema.tasks.id, id), eq(schema.tasks.ownerId, ownerId)))
			.returning();
		if (!t) throw new AppError('NOT_FOUND', 'not found');
		const [s] = await tx.select().from(schema.schedules).where(eq(schema.schedules.taskId, id)).limit(1);
		if (s) {
			const plan = t.plan as TaskPlan;
			const now = new Date();
			const active = status === 'active';
			await tx
				.update(schema.schedules)
				.set({
					active,
					watermarkAt: active ? now : s.watermarkAt,
					nextDueAt: active && plan.schedule.mode === 'recurring' ? nextOccurrence(plan.schedule.rule, s.timezone, now) : s.nextDueAt,
					updatedAt: now
				})
				.where(eq(schema.schedules.id, s.id));
		}
		return t;
	});
}
