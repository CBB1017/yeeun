<script lang="ts">
	import { untrack } from 'svelte';
	import { UserPlus, HardDrive, Shield } from '@lucide/svelte';
	import Button from '../Button.svelte';
	import Notice from '../Notice.svelte';
	import PageHeader from '../PageHeader.svelte';
	import StatusBadge from '../StatusBadge.svelte';
	import ConfirmDialog from '../ConfirmDialog.svelte';
	import { api, messageOf } from '#lib/client/api.ts';
	import { announce } from '#lib/client/live.svelte.ts';
	import { fmtDateTime } from '#lib/client/format.ts';
	import type { Capabilities, Invitation, ProviderHealth, StorageRoot } from '#lib/client/types.ts';

	type Props = { invitations: Invitation[]; capabilities: Capabilities; roots: StorageRoot[]; selfEmail: string };
	let { invitations: i0, capabilities, roots: r0, selfEmail }: Props = $props();

	let invitations = $state<Invitation[]>(untrack(() => i0));
	let roots = $state<StorageRoot[]>(untrack(() => r0));
	let email = $state('');
	let role = $state<'user' | 'admin'>('user');
	let invMsg = $state<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);
	let revokeTarget = $state<Invitation | null>(null);
	let revokeOpen = $state(false);
	let mailTarget = $state<Invitation | null>(null);
	let mailOpen = $state(false);
	let busy = $state(false);

	let hostLabel = $state('');
	let containerPath = $state('');
	let operatorAction = $state<string | null>(null);
	let storageMsg = $state<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);
	let migrateFrom = $state('');
	let migrateOpen = $state(false);

	const active = $derived(roots.find((r) => r.status === 'active') ?? null);

	async function reloadInv() {
		invitations = await api<Invitation[]>('/api/admin/invitations');
	}
	async function reloadRoots() {
		roots = await api<StorageRoot[]>('/api/admin/settings/storage');
	}

	async function invite(e: SubmitEvent) {
		e.preventDefault();
		invMsg = null;
		busy = true;
		try {
			const r = await api<Invitation>('/api/admin/invitations', { method: 'POST', body: { email: email.trim(), role } });
			invMsg =
				r.emailStatus === 'sent'
					? {
							tone: 'success',
							text: `${r.email} 초대를 등록하고 안내 메일을 발송했습니다. SMTP 서버 접수 완료이며 실제 수신 여부는 수신함을 확인하세요.`
						}
					: {
							tone: 'warning',
							text: `${r.email} 초대는 등록됐지만 안내 메일 발송에 실패했습니다. ${r.emailLastError ?? '발송 상태를 확인하세요.'} 아래에서 수동으로 다시 보낼 수 있습니다.`
						};
			announce(invMsg.text);
			email = '';
			await reloadInv();
		} catch (err) {
			invMsg = { tone: 'danger', text: messageOf(err) };
		} finally {
			busy = false;
		}
	}

	async function revoke() {
		if (!revokeTarget) return;
		await api(`/api/admin/invitations/${revokeTarget.id}`, { method: 'DELETE' });
		invMsg = { tone: 'success', text: `${revokeTarget.email} 초대를 취소했습니다.` };
		announce(invMsg.text);
		await reloadInv();
	}

	async function sendMail() {
		if (!mailTarget) return;
		busy = true;
		try {
			const r = await api<Invitation>(`/api/admin/invitations/${mailTarget.id}/email`, {
				method: 'POST',
				body: { expectedAttempts: mailTarget.emailAttempts }
			});
			invMsg =
				r.emailStatus === 'sent'
					? { tone: 'success', text: `${r.email} 안내 메일이 SMTP 서버에 접수됐습니다.` }
					: { tone: 'warning', text: `초대는 유지되지만 메일 발송에 실패했습니다. ${r.emailLastError ?? '발송 상태를 확인하세요.'}` };
			announce(invMsg.text);
			await reloadInv();
		} finally {
			busy = false;
		}
	}

	function canSendMail(inv: Invitation) {
		return (
			inv.status === 'active' &&
			(inv.emailStatus !== 'sending' || (inv.emailAttemptedAt && Date.now() - new Date(inv.emailAttemptedAt).getTime() > 5 * 60_000))
		);
	}

	async function requestRoot(e: SubmitEvent) {
		e.preventDefault();
		storageMsg = null;
		operatorAction = null;
		try {
			const r = await api<{ root: StorageRoot; operator_action: string }>('/api/admin/settings/storage', {
				method: 'PATCH',
				body: { op: 'request', hostLabel: hostLabel.trim(), containerPath: containerPath.trim() }
			});
			operatorAction = r.operator_action;
			storageMsg = {
				tone: 'warning',
				text: '새 보관 위치를 “마운트 대기”로 기록했습니다. 아래 운영자 작업을 마친 뒤 “적용”을 누르세요. 파일은 아직 옮기지 않았습니다.'
			};
			hostLabel = '';
			containerPath = '';
			await reloadRoots();
		} catch (err) {
			storageMsg = { tone: 'danger', text: messageOf(err) };
		}
	}

	async function activate(r: StorageRoot) {
		storageMsg = null;
		try {
			await api('/api/admin/settings/storage', { method: 'PATCH', body: { op: 'activate', id: r.id } });
			storageMsg = {
				tone: 'success',
				text: `${r.containerPath}를 새 파일의 보관 위치로 적용했습니다. 기존 파일은 원래 위치를 그대로 참조합니다 (자동 이동 없음).`
			};
			await reloadRoots();
		} catch (err) {
			storageMsg = { tone: 'danger', text: `${messageOf(err)} — 운영자 작업(마운트)이 필요합니다.` };
		}
	}

	async function migrate() {
		if (!active) return;
		const r = await api<{ moved: number; note: string }>('/api/admin/settings/storage', {
			method: 'PATCH',
			body: { op: 'migrate', fromRootId: migrateFrom, toRootId: active.id }
		});
		storageMsg = { tone: 'success', text: `파일 ${r.moved}개를 복사하고 hash를 검증한 뒤 DB 참조를 바꿨습니다. ${r.note}` };
		await reloadRoots();
	}

	const ROOT_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
		active: { label: '사용 중', tone: 'success' },
		pending_mount: { label: '마운트 대기 (운영자 작업 필요)', tone: 'warning' },
		retired: { label: '이전 위치 (읽기만)', tone: 'neutral' }
	};
	const INV_STATUS: Record<string, { label: string; tone: 'success' | 'neutral' | 'warning' }> = {
		active: { label: '초대됨', tone: 'warning' },
		accepted: { label: '가입함', tone: 'success' },
		revoked: { label: '취소됨', tone: 'neutral' }
	};
	const EMAIL_STATUS: Record<string, { label: string; tone: 'success' | 'neutral' | 'warning' | 'danger' }> = {
		not_requested: { label: '미발송', tone: 'neutral' },
		sending: { label: '발송 중 · 완료 미확인', tone: 'warning' },
		sent: { label: 'SMTP 접수 완료', tone: 'success' },
		failed: { label: '발송 실패', tone: 'danger' }
	};

	function providerOk(p: ProviderHealth | null | undefined) {
		return Boolean(p?.installed && p.logged_in && p.subscription);
	}
</script>

{#snippet yesno(v: boolean | null | undefined, yes: string, no: string)}
	{#if v}<StatusBadge tone="success" label={yes} />{:else if v === false}<StatusBadge tone="danger" label={no} />{:else}<StatusBadge
			tone="neutral"
			label="확인 안 됨"
		/>{/if}
{/snippet}

<div class="max-w-5xl">
	<PageHeader title="관리" description="초대, 실행 환경 상태, 파일 보관 위치를 관리합니다." />

	<div class="space-y-5">
		<section class="card" aria-labelledby="inv-title" data-testid="invitations">
			<h2 id="inv-title" class="section-title flex items-center gap-2"><UserPlus size={20} /> 초대</h2>
			<p class="hint mt-1">
				초대를 등록하면 입력한 이메일로 로그인 안내를 보냅니다. 초대한 Google 계정만 로그인할 수 있으며 초대 취소 시 로그인·대기 실행·예약이
				즉시 멈춥니다.
			</p>
			<form class="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end" onsubmit={invite}>
				<div>
					<label for="inv-email" class="label">Google 계정 이메일</label>
					<input id="inv-email" type="email" class="input" bind:value={email} required autocomplete="off" data-testid="invite-email" />
				</div>
				<div>
					<label for="inv-role" class="label">역할</label>
					<select id="inv-role" class="input" bind:value={role}>
						<option value="user">사용자</option>
						<option value="admin">관리자</option>
					</select>
				</div>
				<Button type="submit" variant="primary" disabled={busy || !email.trim()} data-testid="invite-submit">초대하고 메일 보내기</Button>
			</form>
			{#if invMsg}<Notice tone={invMsg.tone} class="mt-3" role={invMsg.tone === 'danger' ? 'alert' : 'status'}><p>{invMsg.text}</p></Notice
				>{/if}
			{#if invitations.length}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex (scrollable region must be keyboard-scrollable) -->
				<div class="table-wrap mt-4" role="region" aria-labelledby="inv-title" tabindex="0">
					<table class="data-table" data-testid="invitation-table">
						<thead
							><tr
								><th scope="col">이메일</th><th scope="col">역할</th><th scope="col">상태</th><th scope="col">안내 메일</th><th scope="col"
									>초대 시각</th
								><th scope="col"><span class="sr-only">작업</span></th></tr
							></thead
						>
						<tbody>
							{#each invitations as inv (inv.id)}
								<tr>
									<th scope="row" class="font-normal break-all">{inv.email}</th>
									<td>{inv.role === 'admin' ? '관리자' : '사용자'}</td>
									<td
										><StatusBadge
											tone={INV_STATUS[inv.status]?.tone ?? 'neutral'}
											label={INV_STATUS[inv.status]?.label ?? inv.status}
										/></td
									>
									<td>
										<StatusBadge
											tone={EMAIL_STATUS[inv.emailStatus]?.tone ?? 'neutral'}
											label={EMAIL_STATUS[inv.emailStatus]?.label ?? '미발송'}
										/>
										{#if inv.emailSentAt}<p class="hint mt-1">최근 접수 {fmtDateTime(inv.emailSentAt)}</p>{/if}
										{#if inv.emailLastError}<p class="hint mt-1 max-w-xs break-words">{inv.emailLastError}</p>{/if}
									</td>
									<td class="whitespace-nowrap">{fmtDateTime(inv.createdAt)}</td>
									<td>
										{#if canSendMail(inv)}
											<Button
												size="sm"
												disabled={busy}
												onclick={() => ((mailTarget = inv), (mailOpen = true))}
												aria-label="{inv.email} 안내 메일 보내기">{inv.emailAttempts ? '메일 다시 보내기' : '메일 보내기'}</Button
											>
										{/if}
										{#if inv.status !== 'revoked' && inv.email !== selfEmail}
											<Button
												size="sm"
												variant="danger-outline"
												onclick={() => ((revokeTarget = inv), (revokeOpen = true))}
												aria-label="{inv.email} 초대 취소">초대 취소</Button
											>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		<section class="card" aria-labelledby="cap-title" id="capabilities" data-testid="capabilities">
			<h2 id="cap-title" class="section-title flex items-center gap-2"><Shield size={20} /> 실행 환경 상태</h2>
			<p class="hint mt-1">작업자(worker)가 마지막으로 확인한 상태입니다 · 확인 {fmtDateTime(capabilities.checked_at)}</p>
			<div class="mt-3">
				{@render yesno(capabilities.execution_available, '새 실행 가능', '새 실행 불가')}
			</div>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (scrollable region must be keyboard-scrollable) -->
			<div class="table-wrap mt-3" role="region" aria-labelledby="cap-title" tabindex="0">
				<table class="data-table">
					<thead
						><tr
							><th scope="col">CLI</th><th scope="col">설치</th><th scope="col">로그인</th><th scope="col">구독 인증</th><th scope="col"
								>버전</th
							><th scope="col">인증 방식</th></tr
						></thead
					>
					<tbody>
						{#each [['Claude', capabilities.claude], ['Codex', capabilities.codex]] as const as [name, p] (name)}
							<tr>
								<th scope="row">{name}</th>
								<td>{@render yesno(p?.installed, '설치됨', '없음')}</td>
								<td>{@render yesno(p?.logged_in, '로그인됨', '로그인 필요')}</td>
								<td>{@render yesno(p?.subscription, '구독', '구독 아님')}</td>
								<td class="mono">{p?.version ?? '—'}</td>
								<td>{p?.method ?? '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if !providerOk(capabilities.claude) || !providerOk(capabilities.codex)}
				<Notice tone="warning" class="mt-3" title="CLI 로그인이 필요합니다">
					<p>
						운영 문서의 일회성 Compose 로그인 절차로 cli-runner 컨테이너에서 소유자 구독 계정에 로그인하세요. API 키 과금으로 대체하지
						않습니다.
					</p>
				</Notice>
			{/if}
			<dl class="kv mt-4">
				<dt>CLI 실행기 연결</dt>
				<dd>{capabilities.runner === 'reachable' ? '연결됨' : (capabilities.runner ?? '확인 안 됨')}</dd>
				<dt>금지된 API 환경변수</dt>
				<dd>{capabilities.forbidden_env?.length ? capabilities.forbidden_env.join(', ') : '없음'}</dd>
				<dt>보관 위치 쓰기</dt>
				<dd>{capabilities.storage_writable == null ? '확인 안 됨' : capabilities.storage_writable ? '가능' : '불가'}</dd>
				<dt>Google 로그인</dt>
				<dd>{capabilities.google_oauth ? '설정됨' : '설정 안 됨'}</dd>
				<dt>Google Picker</dt>
				<dd>{capabilities.google_picker ? '설정됨' : '설정 안 됨'}</dd>
				<dt>기본 SMTP</dt>
				<dd>{capabilities.smtp_default ? '설정됨' : '설정 안 됨'}</dd>
				<dt>웹 푸시 (VAPID)</dt>
				<dd>{capabilities.web_push ? '설정됨' : '설정 안 됨'}</dd>
			</dl>
		</section>

		<section class="card" aria-labelledby="st-title" data-testid="storage">
			<h2 id="st-title" class="section-title flex items-center gap-2"><HardDrive size={20} /> 파일 보관 위치</h2>
			<p class="hint mt-1">
				앱은 Docker를 제어하지 않습니다. 새 위치는 ① 요청 기록 → ② 운영자가 마운트 → ③ 적용(쓰기 검증) 순서로 바뀌며, 기존 파일은 명시적으로
				이전하기 전까지 원래 위치를 그대로 씁니다. 자동 이동·삭제는 없습니다.
			</p>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (scrollable region must be keyboard-scrollable) -->
			<div class="table-wrap mt-3" role="region" aria-labelledby="st-title" tabindex="0">
				<table class="data-table">
					<thead
						><tr
							><th scope="col">호스트 경로 (표시용)</th><th scope="col">컨테이너 경로</th><th scope="col">상태</th><th scope="col"
								>참조 파일</th
							><th scope="col"><span class="sr-only">작업</span></th></tr
						></thead
					>
					<tbody>
						{#each roots as r (r.id)}
							<tr>
								<th scope="row" class="font-normal break-all">{r.hostLabel}</th>
								<td class="mono">{r.containerPath}</td>
								<td><StatusBadge tone={ROOT_STATUS[r.status]?.tone ?? 'neutral'} label={ROOT_STATUS[r.status]?.label ?? r.status} /></td>
								<td>{r.references}</td>
								<td class="whitespace-nowrap">
									{#if r.status === 'pending_mount'}
										<Button size="sm" onclick={() => activate(r)}>적용 (마운트 확인)</Button>
									{:else if r.status === 'retired' && r.references > 0 && active}
										<Button size="sm" onclick={() => ((migrateFrom = r.id), (migrateOpen = true))}>현재 위치로 이전</Button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<form class="mt-4 grid gap-3 sm:grid-cols-2" onsubmit={requestRoot}>
				<div>
					<label for="st-host" class="label">호스트 경로 (표시용)</label>
					<input id="st-host" class="input" bind:value={hostLabel} required maxlength={500} placeholder="/srv/yeeun-files" />
				</div>
				<div>
					<label for="st-path" class="label">컨테이너 경로</label>
					<input id="st-path" class="input" bind:value={containerPath} required pattern="/[A-Za-z0-9/_\-]+" placeholder="/data2" />
				</div>
				<div class="sm:col-span-2"><Button type="submit">새 위치 요청</Button></div>
			</form>
			{#if storageMsg}<Notice tone={storageMsg.tone} class="mt-3" role={storageMsg.tone === 'danger' ? 'alert' : 'status'}
					><p>{storageMsg.text}</p></Notice
				>{/if}
			{#if operatorAction}
				<div class="mt-3 rounded-[8px] border border-[#fcd34d] bg-warning-soft p-3" data-testid="operator-action">
					<p class="font-semibold">운영자 작업 필요</p>
					<p class="mt-1 break-words">{operatorAction}</p>
				</div>
			{/if}
		</section>
	</div>
</div>

<ConfirmDialog
	bind:open={mailOpen}
	title="초대 안내 메일을 보낼까요?"
	confirmLabel="메일 보내기"
	onconfirm={sendMail}
	testid="confirm-invitation-email"
>
	<p><strong class="break-all">{mailTarget?.email}</strong>에 Google 계정 로그인 안내를 보냅니다.</p>
	<p>
		SMTP 접수 완료가 실제 수신함 도착을 보장하지는 않습니다. 이전 발송이 완료됐거나 상태가 불확실하면 같은 안내가 다시 도착할 수 있습니다.
	</p>
</ConfirmDialog>

<ConfirmDialog
	bind:open={revokeOpen}
	title="초대를 취소할까요?"
	confirmLabel="초대 취소"
	tone="danger"
	onconfirm={revoke}
	testid="confirm-revoke"
>
	<p><strong class="break-all">{revokeTarget?.email}</strong>의 초대를 취소합니다.</p>
	<ul class="list-disc space-y-1 pl-5 text-[0.9375rem]">
		<li>이미 가입한 사용자라면 로그인 세션이 즉시 끊기고 계정이 비활성화됩니다.</li>
		<li>대기 중인 실행은 취소되고, 진행 중인 실행은 취소 요청되며, 예약이 멈춥니다.</li>
		<li>보관된 결과 파일은 삭제하지 않습니다.</li>
	</ul>
</ConfirmDialog>

<ConfirmDialog bind:open={migrateOpen} title="보관 파일을 현재 위치로 이전할까요?" confirmLabel="복사·검증 후 이전" onconfirm={migrate}>
	<p>
		이전 위치의 결과·보관 파일을 현재 위치({active?.containerPath})로 <strong>복사</strong>하고, 파일마다 SHA-256을 검증한 뒤 DB 참조를
		바꿉니다. hash가 다르면 즉시 중단합니다.
	</p>
	<p>이전 위치의 원본 파일은 지우지 않습니다. 확인 후 운영자가 직접 삭제하세요.</p>
</ConfirmDialog>
