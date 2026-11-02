/**
 * E2E seed for the local dev DB (`yeeun`). Creates @example.test users with
 * sessions and realistic tasks/runs (completed with artifacts, awaiting review,
 * failed, queued behind the review, zero-result) plus small real artifact files
 * under the storage root. Idempotent: every run first removes all rows that
 * belong to @example.test users. Tokens are written only to E2E_STATE_DIR
 * (container-local /tmp by default) and are never printed.
 *
 *   node --experimental-strip-types tests/e2e/seed.ts seed|cleanup
 */
import pg from 'pg';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const DOMAIN = '@example.test';
export const STATE_DIR = process.env.E2E_STATE_DIR ?? '/tmp/yeeun-e2e';
const STORAGE_ROOT_FALLBACK = process.env.FILE_STORAGE_ROOT ?? '/data';
const ORIGIN_HOST = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3000').hostname;

function connect() {
	const pwFile = process.env.POSTGRES_PASSWORD_FILE ?? '/run/secrets/postgres_password';
	return new pg.Client({
		host: process.env.POSTGRES_HOST ?? 'db',
		user: process.env.POSTGRES_USER ?? 'yeeun',
		database: process.env.POSTGRES_DB ?? 'yeeun',
		password: fs.readFileSync(pwFile, 'utf8').trim()
	});
}

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const iso = (d: Date) => d.toISOString();
const ago = (min: number) => new Date(Date.now() - min * 60_000);

// ---------- tiny PNG encoder (preview image) ----------
const CRC = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();
function crc32(b: Buffer) {
	let c = 0xffffffff;
	for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(td));
	return Buffer.concat([len, td, crc]);
}
function previewPng(w = 480, h = 300): Buffer {
	const raw = Buffer.alloc((w * 3 + 1) * h);
	for (let y = 0; y < h; y++) {
		raw[y * (w * 3 + 1)] = 0;
		for (let x = 0; x < w; x++) {
			let rgb = [255, 255, 255];
			if (y < 48) rgb = [15, 118, 110];
			else if ((y - 70) % 36 < 14 && y > 70 && x > 24 && x < (y % 72 < 36 ? w - 24 : w - 140)) rgb = [203, 213, 225];
			const o = y * (w * 3 + 1) + 1 + x * 3;
			raw[o] = rgb[0]!;
			raw[o + 1] = rgb[1]!;
			raw[o + 2] = rgb[2]!;
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PDF = Buffer.from(
	'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 72 760 Td (E2E report) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
);

// ---------- cleanup ----------
export async function cleanup(c?: pg.Client) {
	const own = !c;
	const client = c ?? connect();
	if (own) await client.connect();
	try {
		const { rows } = await client.query<{ id: string }>(`select id from users where email like $1`, [`%${DOMAIN}`]);
		const ids = rows.map((r) => r.id);
		const root = await activeRoot(client).catch(() => ({ id: '', path: STORAGE_ROOT_FALLBACK }));
		await client.query('begin');
		if (ids.length) {
			const runs = `(select id from runs where owner_id = any($1::uuid[]))`;
			const tasks = `(select id from tasks where owner_id = any($1::uuid[]))`;
			const stmts = [
				`delete from evidence where owner_id = any($1::uuid[])`,
				`delete from external_actions where owner_id = any($1::uuid[])`,
				`delete from artifacts where owner_id = any($1::uuid[])`,
				`delete from retained_copies where owner_id = any($1::uuid[])`,
				`delete from results where owner_id = any($1::uuid[])`,
				`delete from comparisons where run_id in ${runs}`,
				`delete from cli_executions where run_id in ${runs}`,
				`delete from run_events where owner_id = any($1::uuid[])`,
				`delete from source_snapshots where owner_id = any($1::uuid[])`,
				`delete from notifications where owner_id = any($1::uuid[])`,
				`delete from runs where owner_id = any($1::uuid[])`,
				`delete from schedule_occurrences where task_id in ${tasks}`,
				`delete from schedules where owner_id = any($1::uuid[])`,
				`delete from mute_rules where owner_id = any($1::uuid[])`,
				`delete from task_sources where owner_id = any($1::uuid[])`,
				`delete from tasks where owner_id = any($1::uuid[])`,
				`delete from authoring_calls where owner_id = any($1::uuid[])`,
				`delete from task_drafts where owner_id = any($1::uuid[])`,
				`delete from uploaded_originals where owner_id = any($1::uuid[])`,
				`delete from file_grants where owner_id = any($1::uuid[])`,
				`delete from oauth_connections where owner_id = any($1::uuid[])`,
				`delete from push_subscriptions where owner_id = any($1::uuid[])`,
				`delete from notification_settings where owner_id = any($1::uuid[])`,
				`delete from smtp_profiles where owner_id = any($1::uuid[])`,
				`delete from reviewer_state where owner_id = any($1::uuid[])`,
				`delete from idempotency_keys where owner_id = any($1::uuid[])`,
				`delete from audit_events where actor_id = any($1::uuid[])`,
				`delete from sessions where user_id = any($1::uuid[])`,
				`delete from invitations where invited_by = any($1::uuid[]) or bound_user_id = any($1::uuid[])`
			];
			for (const s of stmts) await client.query(s, [ids]);
		}
		await client.query(`delete from invitations where email like $1`, [`%${DOMAIN}`]);
		if (ids.length) await client.query(`delete from users where id = any($1::uuid[])`, [ids]);
		await client.query('commit');
		for (const id of ids) fs.rmSync(path.join(root.path, 'users', id), { recursive: true, force: true });
		fs.rmSync(STATE_DIR, { recursive: true, force: true });
		return ids.length;
	} catch (e) {
		await client.query('rollback').catch(() => {});
		throw e;
	} finally {
		if (own) await client.end();
	}
}

/**
 * The seed runs as root inside the e2e container, but web/worker run as the
 * `node` user (uid 1000) and must be able to add folders under users/ (e.g.
 * originals uploaded during a test). Hand what the seed created to that user.
 */
const APP_UID = Number(process.env.APP_UID ?? 1000);
function giveToApp(dir: string) {
	if (typeof process.getuid !== 'function' || process.getuid() !== 0 || !fs.existsSync(dir)) return;
	const walk = (p: string) => {
		fs.lchownSync(p, APP_UID, APP_UID);
		if (fs.lstatSync(p).isDirectory()) for (const e of fs.readdirSync(p)) walk(path.join(p, e));
	};
	walk(dir);
}

async function activeRoot(c: pg.Client) {
	const { rows } = await c.query<{ id: string; container_path: string }>(`select id, container_path from storage_roots where status = 'active' limit 1`);
	if (!rows[0]) throw new Error('no active storage root (run migrate first)');
	return { id: rows[0].id, path: rows[0].container_path };
}

// ---------- builders ----------
function deadlinePlan(grant: { id: string; fileId: string; name: string }) {
	return {
		schema_version: 1,
		title: '연구과제 마감 30일 이내 정리',
		goal: '마감일 목록에서 실행 시작일 포함 30일 안에 마감되는 과제를 원본 열 그대로 정리',
		original_prompt: '마감일 목록에서 월~목 10시, 14시에 30일 이내 마감 과제를 엑셀로 정리해서 메일로 보내줘',
		sources: [{ grant_id: grant.id, provider_file_id: grant.fileId, name: grant.name, mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', selector: { sheet: '마감일', header_row: 1, include_hidden_rows: false, include_hidden_slides: false, include_notes: false, csv_encoding: 'utf-8' } }],
		operations: [{ type: 'filter_rows', source_index: 0, column: '마감일', predicate: { kind: 'date_window', start: 'reference_date', days: 30 } }],
		outputs: { web: true, downloads: ['csv', 'pdf'], csv_encoding: 'utf-8-bom' },
		schedule: { mode: 'recurring', raw_text: '월~목 10시, 14시', rule: { kind: 'weekly', weekdays: [1, 2, 3, 4], times: ['10:00', '14:00'] }, timezone: 'Asia/Seoul', holidays: { exclude: false } },
		date_policy: { reference: 'run_start_date', timezone: 'Asia/Seoul' },
		number_policy: { rounding: 'none', digits: 0 },
		notifications: { email: true, push: false },
		external_actions: [{ action: 'drive_upload_copy', format: 'csv', destination_label: '내 Drive / 보고서' }],
		unresolved_questions: [],
		limitations: []
	};
}
function salesPlan(grant: { id: string; fileId: string; name: string } | null) {
	return {
		schema_version: 1,
		title: '매출 합계 확인',
		goal: '매출 파일의 2026년 총매출 합계를 계산',
		original_prompt: '매출 2026 파일의 총매출 합계를 알려줘',
		sources: grant ? [{ grant_id: grant.id, provider_file_id: grant.fileId, name: grant.name, mime_type: 'text/csv', selector: { sheet: null, header_row: null, include_hidden_rows: false, include_hidden_slides: false, include_notes: false, csv_encoding: 'utf-8' } }] : [],
		operations: [{ type: 'answer', question: '2026년 총매출 합계는?', claim_keys: ['total_sales'] }],
		outputs: { web: true, downloads: [], csv_encoding: 'utf-8' },
		schedule: { mode: 'manual' },
		date_policy: { reference: 'run_start_date', timezone: 'Asia/Seoul' },
		number_policy: { rounding: 'none', digits: 0 },
		notifications: { email: true, push: true },
		external_actions: [],
		unresolved_questions: [],
		limitations: []
	};
}

const COLUMNS = [
	{ column_id: 'c1', label: '과제명' },
	{ column_id: 'c2', label: '마감일' },
	{ column_id: 'c3', label: '주관 기관' },
	{ column_id: 'c4', label: '지원 금액(만원)' },
	{ column_id: 'c5', label: '담당자' },
	{ column_id: 'c6', label: '진행 상태' },
	{ column_id: 'c7', label: '비고' },
	{ column_id: 'c8', label: '접수 시스템' }
];
const ROWS: [string, string[]][] = [
	['r2', ['차세대 배터리 소재 기초연구', '2026-11-10', '한국연구재단', '12000', '김연구', '서류 준비', '=SUM(A1:A3) 형태 문자열 포함', 'IRIS']],
	['r5', ['AI 기반 의료영상 분석 플랫폼', '2026-11-21', '정보통신기획평가원', '35000', '이분석', '내부 검토', '공동연구기관 확인 필요', 'IRIS']],
	['r9', ['탄소중립 도시 실증 과제', '2026-12-01', '국토교통과학기술진흥원', '48000', '박실증', '접수 예정', '한 달 경계(11/1→12/1) 포함', 'e-R&D']]
];

function analysis(runId: string, round: number, provider: string, manifestHash: string, summary: string, claims: unknown[], records: unknown[], unc: string[] = []) {
	return { schema_version: 1, run_id: runId, round, provider, manifest_hash: manifestHash, status: 'ok', summary, claims, records, uncertainties: unc };
}

type Q = pg.Client;
async function ins(c: Q, table: string, row: Record<string, unknown>) {
	const keys = Object.keys(row);
	const vals = keys.map((k) => {
		const v = row[k];
		return v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) ? JSON.stringify(v) : Array.isArray(v) && table !== 'oauth_connections' ? JSON.stringify(v) : v;
	});
	await c.query(`insert into ${table} (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')})`, vals);
}
async function events(c: Q, runId: string, ownerId: string, list: [string, Record<string, unknown>, Date][]) {
	let seq = 0;
	for (const [type, data, at] of list) await ins(c, 'run_events', { run_id: runId, owner_id: ownerId, seq: ++seq, type, data, created_at: at });
}

function writeFile(rootPath: string, rel: string, data: Buffer | string) {
	const abs = path.join(rootPath, ...rel.split('/'));
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, data);
	return { rel, sha: sha(typeof data === 'string' ? Buffer.from(data) : data), size: Buffer.byteLength(data) };
}

async function user(c: Q, email: string, name: string, role: 'admin' | 'user') {
	const id = randomUUID();
	await ins(c, 'users', { id, google_sub: `e2e-${email}`, email, email_verified: true, name, role, active: true, timezone: 'Asia/Seoul' });
	await ins(c, 'invitations', { email, status: 'accepted', role, bound_user_id: id, accepted_at: new Date() });
	const token = randomBytes(32).toString('base64url');
	await ins(c, 'sessions', { user_id: id, token_hash: sha(token), csrf_token: randomBytes(24).toString('base64url'), expires_at: new Date(Date.now() + 86_400_000) });
	return { id, token };
}

function storageState(token: string) {
	return {
		cookies: [{ name: 'yeeun_session', value: token, domain: ORIGIN_HOST, path: '/', expires: Math.floor(Date.now() / 1000) + 86_400, httpOnly: true, secure: false, sameSite: 'Lax' as const }],
		origins: []
	};
}

/** A round-1 disagreement (awaiting_review) for `owner`/`task`. */
async function reviewRun(c: Q, root: { id: string; path: string }, ownerId: string, taskId: string, plan: unknown, created: Date) {
	const runId = randomUUID();
	const snapId = randomUUID();
	const mh = sha(`manifest-${runId}`);
	const snapSha = sha(`snap-${runId}`);
	const version = {
		manifest_hash: mh,
		files: [{ index: 0, snapshot_id: snapId, provider_file_id: 'e2eSalesFile0002', name: '매출 2026.csv', mime_type: 'text/csv', provider_revision: '0B7-rev-17', provider_modified_at: iso(ago(600)), captured_at: iso(created), sha256: snapSha, export_format: null, warnings: [], tables: [{ label: '매출 2026', rows: 240, columns: 6 }] }]
	};
	await ins(c, 'runs', { id: runId, owner_id: ownerId, task_id: taskId, trigger: 'manual', state: 'awaiting_review', round: 1, reviewer_provider: 'codex', plan_revision: 1, plan, reference_date: created.toISOString().slice(0, 10), manifest_hash: mh, manifest: version, retention_status: 'retained', started_at: created, created_at: created, updated_at: created, eligible_at: created });
	await ins(c, 'source_snapshots', { id: snapId, run_id: runId, owner_id: ownerId, provider_file_id: 'e2eSalesFile0002', name: '매출 2026.csv', mime_type: 'text/csv', provider_revision: '0B7-rev-17', provider_modified_at: ago(600), captured_at: created, sha256: snapSha, size_bytes: 18234, storage_root_id: root.id, relative_path: `users/${ownerId}/runs/${runId}/snapshots/${randomUUID()}.csv`, extraction_version: 'e2e-1', status: 'active' });
	for (const [key, loc, ex] of [
		['f0:t0:F241', { file: '매출 2026.csv', table: '매출 2026', row: 241, column: '총매출', cell: 'F241' }, '1,234,000'],
		['f0:t0:F12', { file: '매출 2026.csv', table: '매출 2026', row: 12, column: '총매출', cell: 'F12' }, '9,000 (중복 행으로 보임)']
	] as const)
		await ins(c, 'evidence', { run_id: runId, owner_id: ownerId, snapshot_id: snapId, evidence_key: key, kind: 'cell', location: { ...loc, record_id: null }, excerpt: ex });
	const cl = analysis(runId, 1, 'claude', mh, '2026년 총매출 합계는 1,234,000원입니다.', [{ claim_key: 'total_sales', value: { type: 'number', value: '1234000' }, unit: '원', evidence_ids: ['f0:t0:F241'] }], [], ['12행이 중복일 수 있으나 원본 그대로 합산하지 않음']);
	const cx = analysis(runId, 1, 'codex', mh, '2026년 총매출 합계는 1,243,000원입니다.', [{ claim_key: 'total_sales', value: { type: 'number', value: '1243000' }, unit: '원', evidence_ids: ['f0:t0:F241', 'f0:t0:F12'] }], []);
	await ins(c, 'cli_executions', { run_id: runId, round: 1, provider: 'claude', role: 'analysis', input_hash: sha('in-claude' + runId), status: 'succeeded', result: cl, cli_version: '2.1.316', started_at: created, finished_at: new Date(created.getTime() + 90_000) });
	await ins(c, 'cli_executions', { run_id: runId, round: 1, provider: 'codex', role: 'analysis', input_hash: sha('in-claude' + runId), status: 'succeeded', result: cx, cli_version: '0.166.0', started_at: created, finished_at: new Date(created.getTime() + 110_000) });
	await ins(c, 'comparisons', {
		run_id: runId,
		round: 1,
		reviewer: null,
		manifest_hash: mh,
		verdict: 'disagree',
		checks: { failures: [{ provider: 'codex', code: 'AGGREGATE_MISMATCH', detail: '서버 계산 합계 1234000과 다름 (Codex 1243000)' }], warnings: [], expected: [{ index: 0, type: 'answer', count: null, value: null, window: null }] },
		differences: [{ field: 'claims.total_sales', claude_value: '1234000', codex_value: '1243000', reason: '합계 값이 9,000 다름 — 12행 포함 여부' }],
		final: null
	});
	const partial = writeFile(root.path, `users/${ownerId}/runs/${runId}/partial/${randomUUID()}.json`, JSON.stringify({ kind: 'disagreement', round: 1 }));
	await ins(c, 'retained_copies', { run_id: runId, owner_id: ownerId, kind: 'partial', storage_root_id: root.id, relative_path: partial.rel, sha256: partial.sha, data: { kind: 'disagreement' } });
	const t = (s: number) => new Date(created.getTime() + s * 1000);
	await events(c, runId, ownerId, [
		['queued', { trigger: 'manual' }, t(0)],
		['claimed', { round: 1, reviewer: 'codex' }, t(1)],
		['state:preparing', { reference_date: created.toISOString().slice(0, 10) }, t(1)],
		['sources_captured', { manifest_hash: mh, files: 1 }, t(5)],
		['state:executing', { round: 1 }, t(5)],
		['cli_started', { provider: 'claude', role: 'analysis', round: 1 }, t(5)],
		['cli_started', { provider: 'codex', role: 'analysis', round: 1 }, t(5)],
		['cli_finished', { provider: 'claude', role: 'analysis', round: 1, status: 'succeeded', error_code: null }, t(95)],
		['cli_finished', { provider: 'codex', role: 'analysis', round: 1, status: 'succeeded', error_code: null }, t(115)],
		['state:comparing', { reviewer: 'codex' }, t(115)],
		['state:awaiting_review', { round: 1, failures: 1, differences: 1 }, t(116)]
	]);
	await ins(c, 'notifications', { owner_id: ownerId, run_id: runId, task_id: taskId, event_key: `run:${runId}:review_needed`, event: 'review_needed', severity: 'error', channel: 'email', destination_hash: sha('dest-email'), payload: { title: '결과 불일치 — 검토 필요' }, status: 'sent', attempts: 1, sent_at: t(120), created_at: t(116) });
	return runId;
}

export interface SeedIds {
	admin: string;
	other: string;
	reviewer: string;
	taskDeadline: string;
	taskSales: string;
	runCompleted: string;
	runZero: string;
	runFailed: string;
	runReview: string;
	runQueued: string;
	runOther: string;
	runReviewerOwn: string;
	grantIds: string[];
}

export async function seed(): Promise<SeedIds> {
	const c = connect();
	await c.connect();
	try {
		await cleanup(c);
		const root = await activeRoot(c);
		await c.query('begin');
		const A = await user(c, `e2e-admin${DOMAIN}`, 'E2E 관리자', 'admin');
		const B = await user(c, `e2e-other${DOMAIN}`, 'E2E 다른 사용자', 'user');
		const C = await user(c, `e2e-reviewer${DOMAIN}`, 'E2E 검토자', 'user');

		// Drive connection (no tokens: Picker/capture are not exercised) + allowed files.
		const connId = randomUUID();
		await c.query(`insert into oauth_connections (id, owner_id, subject, email, scopes, status) values ($1,$2,$3,$4,$5,'active')`, [connId, A.id, 'e2e-drive-sub', `e2e-admin${DOMAIN}`, ['openid', 'https://www.googleapis.com/auth/drive.file']]);
		const grants = [
			{ id: randomUUID(), fileId: 'e2eDeadlineFile01', name: '마감일 목록.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', folder: '연구지원팀/2026' },
			{ id: randomUUID(), fileId: 'e2eSalesFile0002', name: '매출 2026.csv', mime: 'text/csv', folder: '재무' },
			{ id: randomUUID(), fileId: 'e2eSlidesFile003', name: '분기 보고 회의 자료.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', folder: null }
		];
		for (const [i, g] of grants.entries())
			await ins(c, 'file_grants', { id: g.id, owner_id: A.id, connection_id: connId, provider_file_id: g.fileId, name: g.name, mime_type: g.mime, modified_at: ago(1440 * (i + 1)), folder_label: g.folder, web_view_link: `https://drive.google.com/file/d/${g.fileId}/view`, created_at: ago(5000 - i) });
		const gDeadline = { id: grants[0]!.id, fileId: grants[0]!.fileId, name: grants[0]!.name };
		const gSales = { id: grants[1]!.id, fileId: grants[1]!.fileId, name: grants[1]!.name };

		// Tasks
		const T1 = randomUUID();
		const T2 = randomUUID();
		const p1 = deadlinePlan(gDeadline);
		const p2 = salesPlan(gSales);
		await ins(c, 'tasks', { id: T1, owner_id: A.id, title: p1.title, plan: p1, plan_revision: 1, confirmed_at: ago(4000), status: 'active', created_at: ago(4000) });
		await ins(c, 'tasks', { id: T2, owner_id: A.id, title: p2.title, plan: p2, plan_revision: 1, confirmed_at: ago(3900), status: 'active', created_at: ago(3900) });
		await ins(c, 'task_sources', { task_id: T1, owner_id: A.id, grant_id: gDeadline.id, provider_file_id: gDeadline.fileId, selector: p1.sources[0]!.selector, position: 0 });
		await ins(c, 'task_sources', { task_id: T2, owner_id: A.id, grant_id: gSales.id, provider_file_id: gSales.fileId, selector: p2.sources[0]!.selector, position: 0 });
		// Next due: computed loosely; the UI's "다음 3회" for tasks comes from the server.
		await ins(c, 'schedules', { task_id: T1, owner_id: A.id, revision: 1, rule: p1.schedule.mode === 'recurring' ? p1.schedule.rule : {}, timezone: 'Asia/Seoul', active: true, next_due_at: new Date(Date.now() + 3 * 3600_000), watermark_at: new Date() });

		// ---- completed run with records, artifacts, evidence, deleted snapshot ----
		const rc = randomUUID();
		const created = ago(180);
		const snap = randomUUID();
		const mh = sha(`manifest-${rc}`);
		const snapSha = sha(`deadline-bytes-${rc}`);
		const refDate = '2026-11-02';
		const version = {
			manifest_hash: mh,
			files: [{ index: 0, snapshot_id: snap, provider_file_id: gDeadline.fileId, name: gDeadline.name, mime_type: grants[0]!.mime, provider_revision: null, provider_modified_at: iso(ago(1440)), captured_at: iso(created), sha256: snapSha, export_format: null, warnings: ['병합된 머리글 1개를 첫 칸 기준으로 펼쳤습니다'], tables: [{ label: '마감일', rows: 42, columns: 8 }] }]
		};
		const tableRows = ROWS.map(([rid, vals]) => ({
			record_id: rid,
			cells: Object.fromEntries(COLUMNS.map((col, i) => [col.column_id, { type: i === 1 ? 'date' : i === 3 ? 'number' : 'string', value: vals[i]!, display: i === 3 ? Number(vals[i]).toLocaleString('ko-KR') : vals[i]! }]))
		}));
		const claims = [{ claim_key: 'deadline_count', value: { type: 'count', value: '3' }, unit: '건', evidence_ids: ROWS.map(([rid]) => `f0:t0:${rid}`) }];
		const answer = {
			summary: '실행 시작일(2026-11-02)부터 30일(11-02 ~ 12-01, 양끝 포함) 안에 마감되는 과제는 3건입니다. 12월 1일 마감 과제도 포함했습니다.',
			claims,
			tables: [{ operation_index: 0, window: { from: '2026-11-02', to: '2026-12-01', days: 30 }, columns: COLUMNS, rows: tableRows }],
			warnings: ['마감일 목록.xlsx: 병합된 머리글 1개를 첫 칸 기준으로 펼쳤습니다'],
			uncertainties: ['“접수 예정” 상태의 마감일은 기관 공지로 바뀔 수 있습니다'],
			reviewer: 'claude',
			round: 1,
			reference_date: refDate,
			late: true,
			zero_result: false
		};
		await ins(c, 'runs', { id: rc, owner_id: A.id, task_id: T1, trigger: 'catch_up', state: 'completed', round: 1, reviewer_provider: 'claude', plan_revision: 1, plan: p1, reference_date: refDate, late: true, manifest_hash: mh, manifest: version, retention_status: 'completed', started_at: created, finished_at: new Date(created.getTime() + 300_000), created_at: created, updated_at: created, eligible_at: created });
		await ins(c, 'source_snapshots', { id: snap, run_id: rc, owner_id: A.id, grant_id: gDeadline.id, provider_file_id: gDeadline.fileId, name: gDeadline.name, mime_type: grants[0]!.mime, provider_revision: null, provider_modified_at: ago(1440), captured_at: created, sha256: snapSha, size_bytes: 20480, storage_root_id: root.id, relative_path: `users/${A.id}/runs/${rc}/snapshots/${randomUUID()}.xlsx`, extraction_version: 'e2e-1', status: 'deleted', deleted_at: ago(170) });
		for (const [rid, vals] of ROWS) {
			const rowNo = Number(rid.slice(1));
			await ins(c, 'evidence', { run_id: rc, owner_id: A.id, snapshot_id: snap, evidence_key: `f0:t0:${rid}`, kind: 'row', location: { file: gDeadline.name, table: '마감일', row: rowNo, record_id: rid }, excerpt: vals.join(' | ') });
			await ins(c, 'evidence', { run_id: rc, owner_id: A.id, snapshot_id: snap, evidence_key: `f0:t0:B${rowNo}`, kind: 'cell', location: { file: gDeadline.name, table: '마감일', row: rowNo, column: '마감일', cell: `B${rowNo}`, record_id: rid }, excerpt: vals[1]! });
		}
		const csv = '﻿' + [COLUMNS.map((x) => x.label).join(','), ...ROWS.map(([, v]) => v.map((x) => (x.startsWith('=') ? `'${x}` : x)).map((x) => `"${x}"`).join(','))].join('\r\n') + '\r\n';
		const artDir = `users/${A.id}/runs/${rc}/artifacts`;
		const fCsv = writeFile(root.path, `${artDir}/${randomUUID()}.csv`, csv);
		const fPdf = writeFile(root.path, `${artDir}/${randomUUID()}.pdf`, PDF);
		const fPng = writeFile(root.path, `${artDir}/${randomUUID()}.png`, previewPng());
		const artCsv = randomUUID();
		await ins(c, 'artifacts', { id: artCsv, run_id: rc, owner_id: A.id, storage_root_id: root.id, relative_path: fCsv.rel, mime_type: 'text/csv; charset=utf-8', filename: '연구과제 마감 30일 이내 정리.csv', format: 'csv', size_bytes: fCsv.size, sha256: fCsv.sha, validation: { reopened: true, checks: ['다시 열어 3행·8열 확인', "수식 실행 방지를 위해 =, +, -, @, 탭, CR로 시작하는 셀 1개 앞에 작은따옴표(')를 붙였습니다 — 다운로드 파일의 해당 값은 원본과 다릅니다"], rowCount: 3, formulaInjectionEscaped: 1, preview_path: null } });
		await ins(c, 'artifacts', { run_id: rc, owner_id: A.id, storage_root_id: root.id, relative_path: fPdf.rel, mime_type: 'application/pdf', filename: '연구과제 마감 30일 이내 정리.pdf', format: 'pdf', size_bytes: fPdf.size, sha256: fPdf.sha, validation: { reopened: true, checks: ['1쪽 PDF 다시 열기 확인', '1쪽 미리보기 렌더(80dpi PNG) 생성'], rowCount: 3, formulaInjectionEscaped: 0, preview_path: fPng.rel } });
		await ins(c, 'results', { run_id: rc, owner_id: A.id, answer, version_info: version, record_count: 3 });
		await ins(c, 'comparisons', { run_id: rc, round: 1, reviewer: 'claude', manifest_hash: mh, verdict: 'agree', checks: { failures: [], warnings: [], expected: [{ index: 0, type: 'filter_rows', count: 3, value: null, window: { from: '2026-11-02', to: '2026-12-01' } }] }, differences: [], final: { summary: answer.summary } });
		const recs = ROWS.map(([rid]) => ({ operation_index: 0, source_record_id: rid, evidence_ids: [`f0:t0:${rid}`] }));
		const t = (s: number) => new Date(created.getTime() + s * 1000);
		await ins(c, 'cli_executions', { run_id: rc, round: 1, provider: 'claude', role: 'analysis', input_hash: sha('i' + rc), status: 'succeeded', result: analysis(rc, 1, 'claude', mh, '3건', claims, recs), cli_version: '2.1.316', started_at: t(10), finished_at: t(120) });
		await ins(c, 'cli_executions', { run_id: rc, round: 1, provider: 'codex', role: 'analysis', input_hash: sha('i' + rc), status: 'succeeded', result: analysis(rc, 1, 'codex', mh, '3건', claims, recs), cli_version: '0.166.0', started_at: t(10), finished_at: t(140) });
		await ins(c, 'cli_executions', { run_id: rc, round: 1, provider: 'claude', role: 'review', input_hash: sha('r' + rc), status: 'succeeded', result: { schema_version: 1, run_id: rc, round: 1, reviewer: 'claude', manifest_hash: mh, verdict: 'agree', differences: [], final_summary: answer.summary, uncertainties: [] }, cli_version: '2.1.316', started_at: t(141), finished_at: t(200) });
		await events(c, rc, A.id, [
			['queued', { trigger: 'catch_up' }, t(0)],
			['claimed', { round: 1, reviewer: 'claude' }, t(1)],
			['state:preparing', { reference_date: refDate }, t(1)],
			['sources_captured', { manifest_hash: mh, files: 1 }, t(9)],
			['state:executing', { round: 1 }, t(10)],
			['cli_started', { provider: 'claude', role: 'analysis', round: 1 }, t(10)],
			['cli_started', { provider: 'codex', role: 'analysis', round: 1 }, t(10)],
			['cli_finished', { provider: 'claude', role: 'analysis', round: 1, status: 'succeeded', error_code: null }, t(120)],
			['cli_finished', { provider: 'codex', role: 'analysis', round: 1, status: 'succeeded', error_code: null }, t(140)],
			['state:comparing', { reviewer: 'claude' }, t(140)],
			['cli_started', { provider: 'claude', role: 'review', round: 1 }, t(141)],
			['cli_finished', { provider: 'claude', role: 'review', round: 1, status: 'succeeded', error_code: null }, t(200)],
			['state:finalizing', {}, t(200)],
			['state:completed', { records: 3, artifacts: 2 }, t(300)]
		]);
		await ins(c, 'external_actions', { owner_id: A.id, run_id: rc, artifact_id: artCsv, artifact_sha256: fCsv.sha, action: 'drive_upload_copy', destination: { label: '내 Drive / 보고서' }, destination_hash: sha(JSON.stringify({ label: '내 Drive / 보고서' })), status: 'pending' });
		await ins(c, 'notifications', { owner_id: A.id, run_id: rc, task_id: T1, event_key: `run:${rc}:completed`, event: 'completed', severity: 'normal', channel: 'email', destination_hash: sha('dest-email'), payload: { title: `${p1.title}: 결과 준비됨` }, status: 'sent', attempts: 1, sent_at: t(310), created_at: t(300) });
		await ins(c, 'notifications', { owner_id: A.id, run_id: rc, task_id: T1, event_key: `run:${rc}:completed`, event: 'completed', severity: 'normal', channel: 'push', destination_hash: sha('dest-push'), payload: { title: `${p1.title}: 결과 준비됨` }, status: 'delivery_failed', attempts: 1, last_error: 'push service responded 410', created_at: t(300) });
		await ins(c, 'reviewer_state', { owner_id: A.id, next_provider: 'codex', revision: 1, last_advanced_run_id: rc });

		// ---- zero-result run ----
		const rz = randomUUID();
		const cz = ago(150);
		const snapZ = randomUUID();
		const mhZ = sha(`manifest-${rz}`);
		const versionZ = { manifest_hash: mhZ, files: [{ ...version.files[0]!, snapshot_id: snapZ, provider_revision: '0B1x-rev-0042', captured_at: iso(cz), sha256: sha('z' + rz) }] };
		await ins(c, 'runs', { id: rz, owner_id: A.id, task_id: T1, trigger: 'schedule', state: 'completed', round: 1, reviewer_provider: 'codex', plan_revision: 1, plan: p1, reference_date: refDate, manifest_hash: mhZ, manifest: versionZ, retention_status: 'completed', started_at: cz, finished_at: new Date(cz.getTime() + 200_000), created_at: cz, updated_at: cz, eligible_at: cz });
		await ins(c, 'source_snapshots', { id: snapZ, run_id: rz, owner_id: A.id, provider_file_id: gDeadline.fileId, name: gDeadline.name, mime_type: grants[0]!.mime, provider_revision: '0B1x-rev-0042', captured_at: cz, sha256: sha('z' + rz), size_bytes: 20480, storage_root_id: root.id, relative_path: `users/${A.id}/runs/${rz}/snapshots/${randomUUID()}.xlsx`, extraction_version: 'e2e-1', status: 'deletion_pending' });
		await ins(c, 'results', { run_id: rz, owner_id: A.id, answer: { ...answer, summary: '조건에 맞는 과제가 없습니다 (0건).', claims: [], tables: [{ operation_index: 0, window: { from: '2026-11-02', to: '2026-12-01', days: 30 }, columns: COLUMNS, rows: [] }], warnings: [], uncertainties: [], reviewer: 'codex', late: false, zero_result: true }, version_info: versionZ, record_count: 0 });
		await ins(c, 'comparisons', { run_id: rz, round: 1, reviewer: 'codex', manifest_hash: mhZ, verdict: 'agree', checks: { failures: [], warnings: [], expected: [{ index: 0, type: 'filter_rows', count: 0, value: null, window: null }] }, differences: [], final: { summary: '0건' } });
		await events(c, rz, A.id, [
			['queued', { trigger: 'schedule' }, cz],
			['state:completed', { records: 0, artifacts: 0 }, new Date(cz.getTime() + 200_000)]
		]);

		// ---- failed run (usage limit) ----
		const rf = randomUUID();
		const cf = ago(120);
		await ins(c, 'runs', { id: rf, owner_id: A.id, task_id: T2, trigger: 'manual', state: 'failed', round: 1, reviewer_provider: 'codex', plan_revision: 1, plan: p2, reference_date: refDate, error_code: 'USAGE_LIMIT', error_stage: 'executing', error_message: 'claude: 구독 사용량 한도에 도달함', retention_status: 'retained', started_at: cf, finished_at: new Date(cf.getTime() + 60_000), created_at: cf, updated_at: cf, eligible_at: cf });
		const pf = writeFile(root.path, `users/${A.id}/runs/${rf}/partial/${randomUUID()}.json`, JSON.stringify({ kind: 'error', round: 1 }));
		await ins(c, 'retained_copies', { run_id: rf, owner_id: A.id, kind: 'partial', storage_root_id: root.id, relative_path: pf.rel, sha256: pf.sha, data: { kind: 'error' } });
		await ins(c, 'cli_executions', { run_id: rf, round: 1, provider: 'claude', role: 'analysis', input_hash: sha('f' + rf), status: 'failed', error_code: 'USAGE_LIMIT', error_message: '사용량 한도', started_at: cf, finished_at: new Date(cf.getTime() + 50_000) });
		await ins(c, 'cli_executions', { run_id: rf, round: 1, provider: 'codex', role: 'analysis', input_hash: sha('f' + rf), status: 'cancelled', started_at: cf, finished_at: new Date(cf.getTime() + 51_000) });
		await events(c, rf, A.id, [
			['queued', { trigger: 'manual' }, cf],
			['state:preparing', {}, new Date(cf.getTime() + 1000)],
			['state:executing', { round: 1 }, new Date(cf.getTime() + 5000)],
			['cli_started', { provider: 'claude', role: 'analysis', round: 1 }, new Date(cf.getTime() + 5000)],
			['cli_started', { provider: 'codex', role: 'analysis', round: 1 }, new Date(cf.getTime() + 5000)],
			['cli_finished', { provider: 'claude', role: 'analysis', round: 1, status: 'failed', error_code: 'USAGE_LIMIT' }, new Date(cf.getTime() + 50_000)],
			['cli_finished', { provider: 'codex', role: 'analysis', round: 1, status: 'cancelled', error_code: null }, new Date(cf.getTime() + 51_000)],
			['state:failed', { error_code: 'USAGE_LIMIT', stage: 'executing' }, new Date(cf.getTime() + 60_000)]
		]);

		// ---- awaiting review (holds A's lane) + queued run behind it ----
		const rr = await reviewRun(c, root, A.id, T2, p2, ago(60));
		const rq = randomUUID();
		const cq = ago(30);
		await ins(c, 'runs', { id: rq, owner_id: A.id, task_id: T1, trigger: 'manual', state: 'queued', round: 1, plan_revision: 1, plan: p1, created_at: cq, updated_at: cq, eligible_at: cq, idempotency_key: `e2e-${rq.slice(0, 8)}` });
		await events(c, rq, A.id, [['queued', { trigger: 'manual' }, cq]]);

		// ---- other user (A02) ----
		const TB = randomUUID();
		const pb = salesPlan(null);
		await ins(c, 'tasks', { id: TB, owner_id: B.id, title: '다른 사용자 비공개 업무', plan: pb, plan_revision: 1, confirmed_at: ago(100), status: 'active' });
		const rb = randomUUID();
		await ins(c, 'runs', { id: rb, owner_id: B.id, task_id: TB, trigger: 'manual', state: 'failed', round: 1, plan_revision: 1, plan: pb, error_code: 'SOURCE_MISSING', error_stage: 'preparing', error_message: '비공개 오류 내용', created_at: ago(90), updated_at: ago(90), eligible_at: ago(90) });

		// ---- reviewer user: own awaiting_review run used for the review-request flow ----
		const TC = randomUUID();
		const pc = salesPlan(null);
		await ins(c, 'tasks', { id: TC, owner_id: C.id, title: '검토 흐름 확인용 매출 합계', plan: pc, plan_revision: 1, confirmed_at: ago(100), status: 'active' });
		const rcv = await reviewRun(c, root, C.id, TC, pc, ago(45));

		await c.query('commit');
		giveToApp(path.join(root.path, 'users'));

		const ids: SeedIds = { admin: A.id, other: B.id, reviewer: C.id, taskDeadline: T1, taskSales: T2, runCompleted: rc, runZero: rz, runFailed: rf, runReview: rr, runQueued: rq, runOther: rb, runReviewerOwn: rcv, grantIds: grants.map((g) => g.id) };
		fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
		fs.writeFileSync(path.join(STATE_DIR, 'seed.json'), JSON.stringify(ids, null, 2));
		for (const [name, u] of [['admin', A], ['other', B], ['reviewer', C]] as const) {
			fs.writeFileSync(path.join(STATE_DIR, `${name}.json`), JSON.stringify(storageState(u.token)), { mode: 0o600 });
		}
		return ids;
	} catch (e) {
		await c.query('rollback').catch(() => {});
		throw e;
	} finally {
		await c.end();
	}
}

const isMain = process.argv[1] && /seed\.ts$/.test(process.argv[1]);
if (isMain) {
	const cmd = process.argv[2] ?? 'seed';
	(cmd === 'cleanup' ? cleanup().then((n) => console.log(`removed ${n} @example.test users and their data`)) : seed().then(() => console.log(`seeded; session state written under ${STATE_DIR} (not printed)`))).catch((e) => {
		console.error(e instanceof Error ? e.message : e);
		process.exit(1);
	});
}
