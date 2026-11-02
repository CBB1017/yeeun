import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { useTestDatabase, createUser } from '../setup/db';

useTestDatabase();

const { db, schema, closeDb } = await import('../../src/lib/server/db');
const { setCliRunnerForTests } = await import('../../src/lib/server/cli/client');
const { setSourceFetcherForTests } = await import('../../src/lib/server/sources/capture');
const { claimNext, recoverInterrupted } = await import('../../src/lib/server/queue/dispatcher');
const { executeRun } = await import('../../src/lib/server/runs/executor');
const { createManualRun, requestReview, cancelRun, getOwnedRun, advanceReviewer } = await import('../../src/lib/server/runs/service');
const { runResult, runDetail } = await import('../../src/lib/server/runs/views');
const { cleanupRun } = await import('../../src/lib/server/retention/cleanup');
const { schedulerTick } = await import('../../src/lib/server/schedule/scheduler');
const h = await import('./helpers');

const W = 'test-worker';
const ctx = () => ({ signal: new AbortController().signal, abortReason: () => null });

async function claimAndRun(expectRunId?: string) {
	const c = await claimNext(W);
	expect(c).not.toBeNull();
	if (expectRunId) expect(c!.id).toBe(expectRunId);
	await executeRun(c!.id, ctx());
	const [r] = await db().select().from(schema.runs).where(eq(schema.runs.id, c!.id));
	return r!;
}

async function drainQueue() {
	// Leave no claimable runs between tests (other files' state is isolated by owner anyway).
	await db().execute(
		`update runs set state = 'cancelled' where state in ('queued','review_queued','awaiting_review','preparing','executing','comparing','finalizing')` as never
	);
}

beforeAll(async () => {
	process.env.FILE_STORAGE_ROOT = process.env.FILE_STORAGE_ROOT ?? '/tmp/yeeun-test-data';
});
beforeEach(async () => {
	await drainQueue();
});
afterAll(async () => {
	setCliRunnerForTests(undefined);
	setSourceFetcherForTests(undefined);
	await closeDb();
});

const agreeAll: Parameters<typeof h.fakeRunner>[0] = ({ provider, role, runId, round, manifestHash }) =>
	role === 'analysis'
		? h.ok(
				h.analysis(
					provider,
					runId,
					round,
					manifestHash,
					h.IN_WINDOW,
					provider === 'claude' ? '두 과제가 30일 내 마감' : '30일 안에 마감되는 과제 2건'
				)
			)
		: h.ok(h.review(provider, runId, round, manifestHash, 'agree'));

describe('successful dual execution [MOCK CLI + MOCK Drive]', () => {
	it('A09/A10/A15/A18/A24: independent identical inputs, agreement, round-robin advance, raw-only cleanup', async () => {
		const bytes = await h.researchWorkbook();
		setSourceFetcherForTests(h.fakeFetcher({ bytes, modified: '2026-11-01T00:00:00Z' }));
		const calls: h.Call[] = [];
		setCliRunnerForTests(h.fakeRunner(agreeAll, calls));
		const { user, task } = await h.setupTask();
		const { run } = await createManualRun(user.id, task.id, 'idem-success-1');
		const done = await claimAndRun(run.id);
		expect(done.state).toBe('completed');
		expect(done.reviewerProvider).toBe('claude');

		// A09: each CLI exactly once; prompts identical except the provider line; no other answer leaked.
		const analyses = calls.filter((c) => c.role === 'analysis');
		expect(analyses.map((c) => c.provider).sort()).toEqual(['claude', 'codex']);
		const strip = (p: string) => p.replace(/provider: \w+/, 'provider: X');
		expect(strip(analyses[0]!.prompt)).toBe(strip(analyses[1]!.prompt));
		expect(analyses[0]!.prompt).not.toContain('<result_');
		expect(calls.filter((c) => c.role === 'review').map((c) => c.provider)).toEqual(['claude']);

		// A10: final table keeps source headers/order and exactly the code-verified rows.
		const res = await runResult(user.id, run.id);
		const answer = res.answer as { tables: { columns: { label: string }[]; rows: { record_id: string }[] }[]; zero_result: boolean };
		expect(answer.tables[0]!.columns.map((c) => c.label)).toEqual(['과제번호', '과제명', '마감일', '예산']);
		expect(answer.tables[0]!.rows.map((r) => r.record_id)).toEqual(h.IN_WINDOW);
		expect(res.artifacts.map((a) => a.format).sort()).toEqual(['csv', 'xlsx']);

		// A15: first success -> next reviewer codex
		const [rs] = await db().select().from(schema.reviewerState).where(eq(schema.reviewerState.ownerId, user.id));
		expect(rs!.nextProvider).toBe('codex');

		// A24: raw snapshot deleted; results, artifacts, evidence, version kept
		const before = await db().select().from(schema.evidence).where(eq(schema.evidence.runId, run.id));
		expect(before.length).toBeGreaterThan(0);
		const c = await cleanupRun(run.id);
		expect(c.deleted).toBe(1);
		const snaps = await db().select().from(schema.sourceSnapshots).where(eq(schema.sourceSnapshots.runId, run.id));
		expect(snaps.every((s) => s.status === 'deleted' && s.sha256)).toBe(true);
		expect((await db().select().from(schema.evidence).where(eq(schema.evidence.runId, run.id))).length).toBe(before.length);
		expect((await runResult(user.id, run.id)).artifacts.length).toBe(2);
		expect((await cleanupRun(run.id)).deleted).toBe(0); // idempotent

		// next successful run uses codex as reviewer, then alternates back
		const { run: run2 } = await createManualRun(user.id, task.id, 'idem-success-2');
		const done2 = await claimAndRun(run2.id);
		expect(done2.reviewerProvider).toBe('codex');
		const [rs2] = await db().select().from(schema.reviewerState).where(eq(schema.reviewerState.ownerId, user.id));
		expect(rs2!.nextProvider).toBe('claude');
	});
});

describe('verification and disagreement [MOCK]', () => {
	it('A11: code check failure overrides any model agreement; reviewer not called; no round-robin advance', async () => {
		setSourceFetcherForTests(h.fakeFetcher({ bytes: await h.researchWorkbook(), modified: '2026-11-01T01:00:00Z' }));
		const calls: h.Call[] = [];
		setCliRunnerForTests(
			h.fakeRunner(
				({ provider, role, runId, round, manifestHash }) =>
					role === 'analysis'
						? h.ok(h.analysis(provider, runId, round, manifestHash, provider === 'codex' ? [...h.IN_WINDOW, 'f0.s0.r4'] : h.IN_WINDOW))
						: h.ok(h.review(provider, runId, round, manifestHash, 'agree')),
				calls
			)
		);
		const { user, task } = await h.setupTask();
		const { run } = await createManualRun(user.id, task.id, null);
		const r = await claimAndRun(run.id);
		expect(r.state).toBe('awaiting_review');
		expect(calls.some((c) => c.role === 'review')).toBe(false);
		const [cmp] = await db().select().from(schema.comparisons).where(eq(schema.comparisons.runId, run.id));
		expect(cmp!.verdict).toBe('disagree');
		expect(JSON.stringify(cmp!.checks)).toContain('record_set_mismatch');
		const rs = await db().select().from(schema.reviewerState).where(eq(schema.reviewerState.ownerId, user.id));
		expect(rs[0]?.nextProvider ?? 'claude').toBe('claude');
		// A25: retained partial copy (DB + local file path)
		const kept = await db()
			.select()
			.from(schema.retainedCopies)
			.where(and(eq(schema.retainedCopies.runId, run.id), eq(schema.retainedCopies.kind, 'partial')));
		expect(kept[0]?.relativePath).toMatch(/^users\/.+\/partial\//);
		const snaps = await db().select().from(schema.sourceSnapshots).where(eq(schema.sourceSnapshots.runId, run.id));
		expect(snaps[0]!.status).toBe('active');
	});

	it('A12/A13: one review only, original capture reused, only the fact of disagreement fed back; second disagreement -> disagreed', async () => {
		const state = { bytes: await h.researchWorkbook(), modified: '2026-11-01T01:00:00Z' };
		setSourceFetcherForTests(h.fakeFetcher(state));
		const calls: h.Call[] = [];
		setCliRunnerForTests(
			h.fakeRunner(
				({ provider, role, runId, round, manifestHash }) =>
					role === 'analysis'
						? h.ok(h.analysis(provider, runId, round, manifestHash, provider === 'codex' ? ['f0.s0.r2'] : h.IN_WINDOW))
						: h.ok(h.review(provider, runId, round, manifestHash, 'agree')),
				calls
			)
		);
		const { user, task } = await h.setupTask();
		const { run } = await createManualRun(user.id, task.id, null);
		const first = await claimAndRun(run.id);
		expect(first.state).toBe('awaiting_review');
		const hash1 = first.manifestHash;
		// source edited in Drive after round 1
		state.bytes = Buffer.from('changed');
		state.modified = '2026-11-01T02:00:00Z';
		const [a, b] = await Promise.all([requestReview(user.id, run.id), requestReview(user.id, run.id).catch((e) => e)]);
		expect(a.duplicate || (b as { duplicate?: boolean }).duplicate).toBe(true);
		const second = await claimAndRun(run.id);
		expect(second.round).toBe(2);
		expect(second.manifestHash).toBe(hash1);
		expect(second.state).toBe('disagreed');
		const r2 = calls.filter((c) => c.id.includes(':2:') && c.role === 'analysis');
		expect(r2.length).toBe(2);
		for (const c of r2) {
			expect(c.prompt).toContain('서로 일치하지 않았다');
			expect(c.prompt).not.toContain('f0.s0.r2"]'); // no other answer values
			expect(c.prompt).not.toContain('<result_');
		}
		// no third round possible
		await expect(requestReview(user.id, run.id)).resolves.toMatchObject({ duplicate: true });
		expect(await claimNext(W)).toBeNull();
	});
});

describe('execution errors [MOCK]', () => {
	it('A14: usage limit stops the run, terminates the sibling, no retry, partial retained', async () => {
		setSourceFetcherForTests(h.fakeFetcher({ bytes: await h.researchWorkbook(), modified: '2026-11-01T01:00:00Z' }));
		const calls: h.Call[] = [];
		setCliRunnerForTests({
			...h.fakeRunner(() => h.ok({}), calls),
			async invoke({ id, provider, signal }) {
				calls.push({ id, provider, role: 'analysis', prompt: '', aborted: false });
				if (provider === 'codex')
					return {
						status: 'failed',
						error_code: 'USAGE_LIMIT',
						error_message: 'usage limit reached',
						exit_code: 1,
						duration_ms: 1,
						tool_events: 0
					};
				await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
				calls.find((c) => c.provider === 'claude')!.aborted = true;
				return { status: 'cancelled', error_code: 'CANCELLED', exit_code: null, duration_ms: 1, tool_events: 0 };
			}
		});
		const { user, task } = await h.setupTask();
		const { run } = await createManualRun(user.id, task.id, null);
		const r = await claimAndRun(run.id);
		expect(r.state).toBe('failed');
		expect(r.errorCode).toBe('USAGE_LIMIT');
		expect(calls.find((c) => c.provider === 'claude')!.aborted).toBe(true);
		expect(await claimNext(W)).toBeNull(); // nothing re-queued
		expect(['retained', 'file_only', 'db_only']).toContain(r.retentionStatus);
	});

	it('A14: malformed CLI output -> OUTPUT_SCHEMA_INVALID, no repair call', async () => {
		setSourceFetcherForTests(h.fakeFetcher({ bytes: await h.researchWorkbook(), modified: '2026-11-01T01:00:00Z' }));
		const calls: h.Call[] = [];
		setCliRunnerForTests(
			h.fakeRunner(
				({ provider, runId, round, manifestHash }) =>
					h.ok(provider === 'claude' ? { nope: true } : h.analysis(provider, runId, round, manifestHash, h.IN_WINDOW)),
				calls
			)
		);
		const { user, task } = await h.setupTask();
		const { run } = await createManualRun(user.id, task.id, null);
		const r = await claimAndRun(run.id);
		expect(r.errorCode).toBe('OUTPUT_SCHEMA_INVALID');
		expect(calls.length).toBe(2);
	});

	it('A08: revoked grant -> SOURCE_MISSING, no substitute file', async () => {
		setSourceFetcherForTests(h.fakeFetcher({ bytes: await h.researchWorkbook(), modified: '2026-11-01T01:00:00Z' }));
		setCliRunnerForTests(h.fakeRunner(agreeAll, []));
		const { user, task, grant } = await h.setupTask();
		await db().update(schema.fileGrants).set({ status: 'revoked' }).where(eq(schema.fileGrants.id, grant.id));
		const { run } = await createManualRun(user.id, task.id, null);
		const r = await claimAndRun(run.id);
		expect(r.errorCode).toBe('SOURCE_MISSING');
	});

	it('source changed during capture is reported, not silently analysed', async () => {
		setSourceFetcherForTests(h.fakeFetcher({ bytes: await h.researchWorkbook(), modified: 'm', changeDuringCapture: true }));
		setCliRunnerForTests(h.fakeRunner(agreeAll, []));
		const { user, task } = await h.setupTask();
		const { run } = await createManualRun(user.id, task.id, null);
		expect((await claimAndRun(run.id)).errorCode).toBe('SOURCE_CHANGED_DURING_CAPTURE');
	});
});

describe('cancellation and timeout of an active run [MOCK]', () => {
	for (const reason of ['cancelled', 'timeout'] as const) {
		it(`A14/4.4: ${reason} stops both CLIs, retains partial data, never retries`, async () => {
			setSourceFetcherForTests(h.fakeFetcher({ bytes: await h.researchWorkbook(), modified: '2026-11-01T01:00:00Z' }));
			const calls: h.Call[] = [];
			let release: () => void = () => {};
			const started = new Promise<void>((r) => (release = r));
			let n = 0;
			setCliRunnerForTests({
				...h.fakeRunner(() => h.ok({}), calls),
				async invoke({ id, provider, signal }) {
					const call: h.Call = { id, provider, role: 'analysis', prompt: '', aborted: false };
					calls.push(call);
					if (++n === 2) release();
					await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
					call.aborted = true;
					return { status: 'cancelled', error_code: 'CANCELLED', exit_code: null, duration_ms: 1, tool_events: 0 };
				}
			});
			const { user, task } = await h.setupTask();
			const { run } = await createManualRun(user.id, task.id, null);
			const c = await claimNext(W);
			const ac = new AbortController();
			let why: 'cancelled' | 'timeout' | null = null;
			const p = executeRun(c!.id, { signal: ac.signal, abortReason: () => why });
			await started;
			why = reason;
			ac.abort();
			await p;
			const [r] = await db().select().from(schema.runs).where(eq(schema.runs.id, run.id));
			expect(r!.state).toBe(reason === 'cancelled' ? 'cancelled' : 'failed');
			expect(r!.errorCode).toBe(reason === 'cancelled' ? 'CANCELLED' : 'TIMEOUT');
			expect(calls.filter((x) => x.aborted).length).toBe(2);
			expect(['retained', 'file_only', 'db_only']).toContain(r!.retentionStatus);
			expect(await claimNext(W)).toBeNull();
		});
	}
});

describe('queue, lanes, idempotency and isolation', () => {
	it('A16: own run awaiting review holds the user lane; another user can run', async () => {
		const { user: u1, task: t1 } = await h.setupTask();
		const { user: u2, task: t2 } = await h.setupTask();
		const { run: r1 } = await createManualRun(u1.id, t1.id, null);
		await db().update(schema.runs).set({ state: 'awaiting_review' }).where(eq(schema.runs.id, r1.id));
		const { run: r1b } = await createManualRun(u1.id, t1.id, null);
		const { run: r2 } = await createManualRun(u2.id, t2.id, null);
		const c = await claimNext(W);
		expect(c!.id).toBe(r2.id);
		expect(c!.id).not.toBe(r1b.id);
		const d = await runDetail(u1.id, r1b.id);
		expect(d.waiting?.kind).toBe('lane_review');
		// cancelling the review releases the lane
		await cancelRun(u1.id, r1.id);
		await db().update(schema.runs).set({ state: 'cancelled' }).where(eq(schema.runs.id, r2.id));
		expect((await claimNext(W))!.id).toBe(r1b.id);
	});

	it('A32: duplicate Idempotency-Key creates one run; round-robin advances once per run', async () => {
		const { user, task } = await h.setupTask();
		const [a, b] = await Promise.all([createManualRun(user.id, task.id, 'dup-key-123'), createManualRun(user.id, task.id, 'dup-key-123')]);
		expect(a.run.id).toBe(b.run.id);
		const runs = await db().select().from(schema.runs).where(eq(schema.runs.taskId, task.id));
		expect(runs.length).toBe(1);
		await db().transaction((tx) => advanceReviewer(tx, user.id, a.run.id, 'claude'));
		await db().transaction((tx) => advanceReviewer(tx, user.id, a.run.id, 'claude'));
		const [rs] = await db().select().from(schema.reviewerState).where(eq(schema.reviewerState.ownerId, user.id));
		expect(rs!.nextProvider).toBe('codex');
		expect(rs!.revision).toBe(1);
	});

	it('A17: expired active lease -> interrupted, never re-executed', async () => {
		const { user, task } = await h.setupTask();
		const { run } = await createManualRun(user.id, task.id, null);
		await db()
			.update(schema.runs)
			.set({ state: 'executing', leaseExpiresAt: new Date(Date.now() - 1000) })
			.where(eq(schema.runs.id, run.id));
		const ids = await recoverInterrupted();
		expect(ids).toContain(run.id);
		expect((await getOwnedRun(user.id, run.id)).state).toBe('interrupted');
		expect(await claimNext(W)).toBeNull();
	});

	it('A02: another user cannot read run/result/detail', async () => {
		const { user, task } = await h.setupTask();
		const other = await createUser();
		const { run } = await createManualRun(user.id, task.id, null);
		await expect(getOwnedRun(other.id, run.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
		await expect(runDetail(other.id, run.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
		await expect(cancelRun(other.id, run.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
	});
});

describe('scheduling', () => {
	it('A17: many missed occurrences coalesce into ONE catch-up run; repeated ticks add nothing', async () => {
		const { user, task, plan } = await h.setupTask();
		const rule = { kind: 'weekly' as const, weekdays: [1, 2, 3, 4], times: ['10:00', '14:00'] };
		plan.schedule = { mode: 'recurring', raw_text: '월~목 10시 14시', rule, timezone: h.TZ, holidays: { exclude: false } };
		await db().update(schema.tasks).set({ plan }).where(eq(schema.tasks.id, task.id));
		const past = new Date(Date.now() - 8 * 86_400_000);
		await db()
			.insert(schema.schedules)
			.values({ taskId: task.id, ownerId: user.id, revision: 1, rule, timezone: h.TZ, watermarkAt: past, nextDueAt: past });
		const r1 = await schedulerTick();
		expect(r1.created).toBe(1);
		const r2 = await schedulerTick();
		expect(r2.created).toBe(0);
		const occ = await db().select().from(schema.scheduleOccurrences).where(eq(schema.scheduleOccurrences.taskId, task.id));
		expect(occ.length).toBe(1);
		expect(occ[0]!.missedCount).toBeGreaterThan(1);
		const runs = await db().select().from(schema.runs).where(eq(schema.runs.taskId, task.id));
		expect(runs.length).toBe(1);
		expect(['catch_up', 'schedule']).toContain(runs[0]!.trigger);
	});
});
