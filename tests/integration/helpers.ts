import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { DateTime } from 'luxon';
import { db, schema } from '../../src/lib/server/db';
import { createUser } from '../setup/db';
import type { CliRunner, RunnerResult } from '../../src/lib/server/cli/client';
import type { SourceFetcher } from '../../src/lib/server/sources/capture';
import { defaultSelector, emptyPlan, type TaskPlan } from '../../src/lib/shared/plan';
import type { AnalysisResult, Provider } from '../../src/lib/shared/protocol';

/** MOCK helpers: fake CLI runner and fake Drive fetcher. Not live verification. */

export const TZ = 'Asia/Seoul';
export function today(): string {
	return DateTime.now().setZone(TZ).toISODate()!;
}
export function plusDays(n: number): Date {
	const d = DateTime.fromISO(today(), { zone: 'UTC' }).plus({ days: n });
	return new Date(Date.UTC(d.year, d.month - 1, d.day));
}

export async function researchWorkbook(): Promise<Buffer> {
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet('과제목록');
	ws.addRow(['과제번호', '과제명', '마감일', '예산']);
	ws.addRow(['R-001', '오늘 마감', plusDays(0), 1000]); // row 2: in window
	ws.addRow(['R-002', '29일 후', plusDays(29), 2000]); // row 3: in window (last inclusive day)
	ws.addRow(['R-003', '30일 후', plusDays(30), 3000]); // row 4: outside
	ws.addRow(['R-004', '어제 마감', plusDays(-1), 4000]); // row 5: outside
	ws.getColumn(3).numFmt = 'yyyy-mm-dd';
	return Buffer.from(await wb.xlsx.writeBuffer());
}
export const IN_WINDOW = ['f0.s0.r2', 'f0.s0.r3'];

export function fakeFetcher(state: { bytes: Buffer; modified: string; changeDuringCapture?: boolean }): SourceFetcher {
	let calls = 0;
	return {
		async meta(_owner, fileId) {
			calls++;
			const changed = state.changeDuringCapture && calls % 2 === 0;
			return {
				id: fileId,
				name: '연구과제.xlsx',
				mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
				modifiedTime: changed ? '2099-01-01T00:00:00Z' : state.modified,
				headRevisionId: 'rev-1',
				size: String(state.bytes.length),
				md5Checksum: createHash('md5').update(state.bytes).digest('hex')
			};
		},
		async bytes(_owner, _meta) {
			return { bytes: state.bytes, exportFormat: null, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
		}
	};
}

export interface Call {
	id: string;
	provider: Provider;
	role: string;
	prompt: string;
	aborted: boolean;
}

type Behaviour = (c: {
	provider: Provider;
	role: 'analysis' | 'review';
	runId: string;
	round: number;
	manifestHash: string;
	prompt: string;
}) => Promise<RunnerResult> | RunnerResult;

export function fakeRunner(behaviour: Behaviour, calls: Call[]): CliRunner {
	return {
		async status() {
			const s = { installed: true, version: 'mock', logged_in: true, subscription: true, method: 'mock', detail: null };
			return { forbidden_env: [], providers: { claude: s, codex: s } };
		},
		async invoke({ id, provider, prompt, signal }) {
			const role = id.endsWith(':review') ? 'review' : 'analysis';
			const call: Call = { id, provider, role, prompt, aborted: false };
			calls.push(call);
			const runId = /run_id: (\S+)/.exec(prompt)![1]!;
			const round = Number(/round: (\d)/.exec(prompt)![1]);
			const manifestHash = /manifest_hash: (\S+)/.exec(prompt)![1]!;
			const out = await behaviour({ provider, role: role as 'analysis' | 'review', runId, round, manifestHash, prompt });
			if (signal.aborted) call.aborted = true;
			return out;
		}
	};
}

export function ok(output: unknown): RunnerResult {
	return { status: 'succeeded', output, exit_code: 0, duration_ms: 5, tool_events: 0, cli_version: 'mock', model: 'mock' };
}

export function analysis(
	provider: Provider,
	runId: string,
	round: number,
	manifestHash: string,
	records: string[],
	summary = '마감 임박 과제'
): AnalysisResult {
	return {
		schema_version: 1,
		run_id: runId,
		round,
		provider,
		manifest_hash: manifestHash,
		status: 'ok',
		summary,
		claims: [],
		records: records.map((r) => ({ operation_index: 0, source_record_id: r, evidence_ids: [r] })),
		uncertainties: []
	};
}

export function review(reviewer: Provider, runId: string, round: number, manifestHash: string, verdict: 'agree' | 'disagree') {
	return {
		schema_version: 1,
		run_id: runId,
		round,
		reviewer,
		manifest_hash: manifestHash,
		verdict,
		differences: verdict === 'agree' ? [] : [{ field: 'summary', claude_value: 'a', codex_value: 'b', reason: '다름' }],
		final_summary: verdict === 'agree' ? '30일 이내 마감 과제 2건' : null,
		uncertainties: []
	};
}

export async function setupTask(opts: { downloads?: TaskPlan['outputs']['downloads']; ownerId?: string } = {}) {
	mkdirSync(process.env.FILE_STORAGE_ROOT ?? '/tmp/yeeun-test-data', { recursive: true });
	const user = opts.ownerId ? { id: opts.ownerId } : await createUser();
	const [conn] = await db()
		.insert(schema.oauthConnections)
		.values({ ownerId: user.id, subject: `g-${user.id}`, scopes: ['https://www.googleapis.com/auth/drive.file'] })
		.returning();
	const [grant] = await db()
		.insert(schema.fileGrants)
		.values({
			ownerId: user.id,
			connectionId: conn!.id,
			providerFileId: `file${user.id.replace(/-/g, '')}`,
			name: '연구과제.xlsx',
			mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		})
		.returning();
	const plan = emptyPlan('30일 이내 마감 과제 목록', TZ);
	plan.title = '연구 과제 마감';
	plan.sources = [
		{
			grant_id: grant!.id,
			provider_file_id: grant!.providerFileId,
			name: grant!.name,
			mime_type: grant!.mimeType,
			selector: defaultSelector()
		}
	];
	plan.operations = [
		{ type: 'filter_rows', source_index: 0, column: '마감일', predicate: { kind: 'date_window', start: 'reference_date', days: 30 } }
	];
	plan.outputs.downloads = opts.downloads ?? ['xlsx', 'csv'];
	const [task] = await db()
		.insert(schema.tasks)
		.values({ ownerId: user.id, title: plan.title, plan, planRevision: 1, confirmedAt: new Date() })
		.returning();
	await db()
		.insert(schema.taskSources)
		.values({
			taskId: task!.id,
			ownerId: user.id,
			grantId: grant!.id,
			providerFileId: grant!.providerFileId,
			selector: defaultSelector(),
			position: 0
		});
	return { user, grant: grant!, task: task!, plan, connection: conn! };
}
