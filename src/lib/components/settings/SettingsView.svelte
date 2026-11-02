<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { Mail, Smartphone, Send, Plus, Trash } from '@lucide/svelte';
	import Button from '../Button.svelte';
	import Notice from '../Notice.svelte';
	import Modal from '../Modal.svelte';
	import Toggle from '../Toggle.svelte';
	import PageHeader from '../PageHeader.svelte';
	import StatusBadge from '../StatusBadge.svelte';
	import { api, messageOf } from '#lib/client/api.ts';
	import { announce } from '#lib/client/live.svelte.ts';
	import { pushSupport, permissionState, registerThisDevice, unregisterDevice, localDeviceId, type PushSupport } from '#lib/client/push.ts';
	import { browserTimezone, fmtDateTime, isIos, isStandalone, CHANNEL_LABEL, NOTIFICATION_EVENT, NOTIFICATION_STATUS } from '#lib/client/format.ts';
	import type { Me, NotificationItem, NotificationSettings, SenderProfile } from '#lib/client/types.ts';

	type Props = { me: Me; initial: NotificationSettings; senders: SenderProfile[]; recent: NotificationItem[] };
	let { me, initial, senders: senders0, recent: recent0 }: Props = $props();

	let s = $state<NotificationSettings>(untrack(() => initial));
	let senders = $state<SenderProfile[]>(untrack(() => senders0));
	let recent = $state<NotificationItem[]>(untrack(() => recent0));

	let emailMsg = $state<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null);
	let pushMsg = $state<{ tone: 'success' | 'danger' | 'info' | 'warning'; text: string } | null>(null);
	let testMsg = $state<{ tone: 'success' | 'danger'; text: string } | null>(null);
	let newRecipient = $state('');
	let code = $state('');
	let busy = $state<string | null>(null);

	let support = $state<PushSupport>('unsupported');
	let permission = $state<NotificationPermission | 'unsupported'>('unsupported');
	let ios = $state(false);
	let thisDevice = $state<string | null>(null);
	const tz = browserTimezone();

	onMount(() => {
		ios = isIos();
		support = pushSupport(ios, isStandalone());
		permission = permissionState();
		thisDevice = localDeviceId();
	});

	async function patch(body: { emailEnabled?: boolean; pushEnabled?: boolean; smtpProfileId?: string | null }, which: 'email' | 'push') {
		busy = which;
		try {
			s = await api<NotificationSettings>('/api/settings/notifications', { method: 'PATCH', body });
			const t = which === 'email' ? `이메일 알림을 ${s.emailEnabled ? '켰습니다' : '껐습니다'}` : `브라우저 푸시 알림을 ${s.pushEnabled ? '켰습니다' : '껐습니다'}`;
			announce(t);
			if (which === 'email' && 'smtpProfileId' in body) emailMsg = { tone: 'success', text: '발신 프로필을 바꿨습니다.' };
		} catch (e) {
			const m = { tone: 'danger' as const, text: messageOf(e) };
			if (which === 'email') emailMsg = m;
			else pushMsg = m;
		} finally {
			busy = null;
		}
	}

	async function recipient(body: { action: 'start'; email: string } | { action: 'confirm'; code: string } | { action: 'use_login_email' }) {
		emailMsg = null;
		busy = 'recipient';
		try {
			if (body.action === 'start') {
				const r = await api<{ pendingRecipient: string; expiresAt: string }>('/api/settings/recipient', { method: 'POST', body });
				s.pendingRecipient = r.pendingRecipient;
				s.challengeExpiresAt = r.expiresAt;
				emailMsg = { tone: 'info', text: `${r.pendingRecipient}(으)로 6자리 확인 코드를 보냈습니다. 확인 전에는 이 주소로 알림을 보내지 않습니다.` };
			} else {
				s = await api<NotificationSettings>('/api/settings/recipient', { method: 'POST', body });
				code = '';
				newRecipient = '';
				emailMsg = { tone: 'success', text: `수신 주소를 ${s.recipientEmail}(으)로 확인했습니다.` };
			}
			announce(emailMsg.text);
		} catch (e) {
			emailMsg = { tone: 'danger', text: messageOf(e) };
		} finally {
			busy = null;
		}
	}

	async function registerDevice() {
		pushMsg = null;
		if (!s.vapidPublicKey || !s.pushConfigured) {
			pushMsg = { tone: 'warning', text: '운영자가 푸시 키(VAPID)를 설정하지 않아 기기를 등록할 수 없습니다.' };
			return;
		}
		busy = 'device';
		try {
			const r = await registerThisDevice(s.vapidPublicKey);
			permission = r.permission;
			if (r.permission !== 'granted') {
				pushMsg = { tone: 'warning', text: '브라우저 알림 권한이 허용되지 않아 이 기기를 등록하지 않았습니다. 이메일 설정은 바뀌지 않았습니다.' };
				return;
			}
			thisDevice = r.id;
			s = await api<NotificationSettings>('/api/settings/notifications');
			pushMsg = { tone: 'success', text: '이 기기를 푸시 알림 대상으로 등록했습니다.' };
		} catch (e) {
			pushMsg = { tone: 'danger', text: messageOf(e) };
		} finally {
			busy = null;
		}
	}

	async function refreshSettings() {
		const r = await api<{ settings: NotificationSettings; senders: SenderProfile[]; recent: NotificationItem[] }>('/api/settings/notifications');
		s = r.settings;
		senders = r.senders;
		recent = r.recent;
	}

	async function removeDevice(id: string) {
		busy = `rm-${id}`;
		try {
			await unregisterDevice(id);
			if (thisDevice === id) thisDevice = null;
			await refreshSettings();
			pushMsg = { tone: 'success', text: '기기 등록을 해제했습니다.' };
		} catch (e) {
			pushMsg = { tone: 'danger', text: messageOf(e) };
		} finally {
			busy = null;
		}
	}

	async function sendTest() {
		testMsg = null;
		busy = 'test';
		try {
			await api('/api/settings/notifications/test', { method: 'POST' });
			testMsg = { tone: 'success', text: '테스트 알림을 보내기 대기열에 넣었습니다. 켜 둔 채널로만 보내며, 아래 “최근 알림”에서 전송 결과를 확인하세요.' };
			announce(testMsg.text);
			await refreshSettings();
		} catch (e) {
			testMsg = { tone: 'danger', text: messageOf(e) };
		} finally {
			busy = null;
		}
	}

	async function resend(id: string) {
		try {
			await api(`/api/notifications/${id}/resend`, { method: 'POST' });
			await refreshSettings();
			announce('다시 보내기를 요청했습니다');
		} catch (e) {
			testMsg = { tone: 'danger', text: messageOf(e) };
		}
	}

	// ---- personal SMTP profile ----
	let smtpOpen = $state(false);
	let smtp = $state({ label: '', host: '', port: 587, secure: false, username: '', password: '', fromAddress: '', shared: false });
	let smtpErr = $state('');
	async function createSmtp(e: SubmitEvent) {
		e.preventDefault();
		smtpErr = '';
		busy = 'smtp';
		try {
			await api<SenderProfile>('/api/settings/smtp-profiles', { method: 'POST', body: { ...smtp, port: Number(smtp.port) } });
			smtp.password = '';
			smtpOpen = false;
			await refreshSettings();
			emailMsg = { tone: 'success', text: 'SMTP 연결을 확인하고 발신 프로필을 추가했습니다. 위에서 선택하세요.' };
		} catch (err) {
			smtp.password = '';
			smtpErr = messageOf(err);
		} finally {
			busy = null;
		}
	}

	const selectedSender = $derived(senders.find((p) => p.id === s.smtpProfileId) ?? null);
</script>

<div class="max-w-4xl">
	<PageHeader title="알림·설정" description="이메일과 브라우저 푸시는 서로 독립입니다. 한 채널을 켜거나 끄거나, 한 채널이 안 되어도 다른 채널을 자동으로 바꾸지 않습니다." />

	<div class="space-y-5">
		<section class="card space-y-4" aria-labelledby="email-title" data-testid="email-section">
			<h2 id="email-title" class="section-title flex items-center gap-2"><Mail size={20} /> 이메일 알림</h2>
			<Toggle id="email-enabled" label="이메일로 알림 받기" description="결과·0건·검토 필요·오류 알림을 확인한 수신 주소로 보냅니다." checked={s.emailEnabled} disabled={busy === 'email'} onchange={(v) => patch({ emailEnabled: v }, 'email')} />

			<div class="border-t border-line-soft pt-4">
				<h3 class="font-semibold">수신 주소</h3>
				{#if s.recipientEmail}
					<p class="mt-1 flex flex-wrap items-center gap-2">
						<span class="font-semibold break-all">{s.recipientEmail}</span>
						{#if s.recipientVerified}<StatusBadge tone="success" label="확인됨" />{:else}<StatusBadge tone="warning" label="미확인" />{/if}
					</p>
				{:else}
					<p class="mt-1 text-warning">수신 주소가 없습니다. 이메일 알림을 켜도 주소를 확인할 때까지 보내지 않습니다.</p>
				{/if}
				{#if s.loginEmail && s.loginEmailVerified && s.recipientEmail !== s.loginEmail}
					<div class="mt-2">
						<Button size="sm" onclick={() => recipient({ action: 'use_login_email' })} disabled={busy === 'recipient'}>로그인 이메일({s.loginEmail}) 사용</Button>
					</div>
				{/if}
				<form
					class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
					onsubmit={(e) => {
						e.preventDefault();
						recipient({ action: 'start', email: newRecipient.trim() });
					}}
				>
					<div class="min-w-0 flex-1">
						<label for="new-recipient" class="label">다른 주소로 변경</label>
						<input id="new-recipient" type="email" class="input" bind:value={newRecipient} autocomplete="email" required />
					</div>
					<Button type="submit" disabled={busy === 'recipient' || !newRecipient.trim()}>확인 코드 보내기</Button>
				</form>
				{#if s.pendingRecipient}
					<form
						class="mt-3 flex flex-col gap-2 rounded-[8px] bg-subtle p-3 sm:flex-row sm:items-end"
						onsubmit={(e) => {
							e.preventDefault();
							recipient({ action: 'confirm', code: code.trim() });
						}}
					>
						<div class="min-w-0 flex-1">
							<label for="code" class="label">{s.pendingRecipient}(으)로 받은 6자리 코드</label>
							<input id="code" class="input max-w-48" inputmode="numeric" autocomplete="one-time-code" pattern="\d{6}" maxlength={6} bind:value={code} aria-describedby="code-hint" />
							<p id="code-hint" class="hint mt-1">만료 {fmtDateTime(s.challengeExpiresAt)} · 5번 틀리면 다시 요청해야 합니다.</p>
						</div>
						<Button type="submit" variant="primary" disabled={busy === 'recipient' || !/^\d{6}$/.test(code.trim())}>주소 확인</Button>
					</form>
				{/if}
			</div>

			<div class="border-t border-line-soft pt-4">
				<label for="sender" class="label">발신 프로필</label>
				<select
					id="sender"
					class="input max-w-lg"
					value={s.smtpProfileId ?? ''}
					disabled={busy === 'email'}
					onchange={(e) => patch({ smtpProfileId: (e.currentTarget as HTMLSelectElement).value || null }, 'email')}
				>
					<option value="">기본 발신 (운영자 설정)</option>
					{#each senders as p (p.id)}
						<option value={p.id} disabled={!p.verified}>{p.label} — {p.fromAddress}{p.shared ? ' (공유)' : ' (개인)'}{p.verified ? '' : ' (연결 미확인)'}</option>
					{/each}
				</select>
				<p class="hint mt-1">{selectedSender ? `${selectedSender.fromAddress}에서 보냅니다.` : '운영자가 설정한 기본 SMTP로 보냅니다.'} 연결을 확인한 프로필만 고를 수 있습니다.</p>
				<div class="mt-2"><Button size="sm" onclick={() => (smtpOpen = true)}><Plus size={16} />개인 SMTP 프로필 추가</Button></div>
			</div>
			{#if emailMsg}<Notice tone={emailMsg.tone} role={emailMsg.tone === 'danger' ? 'alert' : 'status'}><p>{emailMsg.text}</p></Notice>{/if}
		</section>

		<section class="card space-y-4" aria-labelledby="push-title" data-testid="push-section">
			<h2 id="push-title" class="section-title flex items-center gap-2"><Smartphone size={20} /> 브라우저 푸시 알림</h2>
			<Toggle id="push-enabled" label="브라우저 푸시로 알림 받기" description="등록한 기기에 짧은 상태와 링크만 보냅니다. 내용은 로그인 후 웹에서 봅니다." checked={s.pushEnabled} disabled={busy === 'push'} onchange={(v) => patch({ pushEnabled: v }, 'push')} />

			{#if !s.pushConfigured}
				<Notice tone="warning"><p>운영자가 푸시 키를 설정하지 않아 지금은 푸시를 보낼 수 없습니다. 이메일 설정은 이와 관계없이 그대로 유지됩니다.</p></Notice>
			{/if}
			{#if support === 'needs_home_screen'}
				<Notice tone="info" title="iPhone·iPad는 홈 화면에 추가해야 합니다"><p>Safari의 공유 버튼 → “홈 화면에 추가”로 이 앱을 추가한 뒤, 홈 화면 아이콘으로 열어 기기를 등록하세요 (iOS 16.4 이상).</p></Notice>
			{:else if support === 'unsupported'}
				<Notice tone="info" testid="push-unsupported"><p>이 브라우저는 웹 푸시를 지원하지 않습니다. 이메일 알림은 따로 쓸 수 있으며 자동으로 켜지지 않습니다.</p></Notice>
			{:else if permission === 'denied'}
				<Notice tone="warning" title="이 브라우저에서 알림이 차단되어 있습니다" testid="push-denied">
					<p>주소창의 사이트 설정에서 알림을 “허용”으로 바꾼 뒤 다시 등록하세요. 이메일 설정은 바뀌지 않으며 자동으로 켜지지 않습니다.</p>
				</Notice>
			{/if}

			<div class="border-t border-line-soft pt-4">
				<h3 class="font-semibold">등록한 기기</h3>
				{#if s.pushSubscriptions.length === 0}
					<p class="hint mt-1">등록한 기기가 없습니다. 푸시를 켜도 기기가 없으면 보내지 않습니다.</p>
				{:else}
					<ul class="mt-1 divide-y divide-line-soft">
						{#each s.pushSubscriptions as d (d.id)}
							<li class="flex flex-wrap items-center justify-between gap-2 py-2">
								<span class="min-w-0">
									<span class="font-semibold">{d.deviceLabel ?? '이름 없는 기기'}</span>{#if thisDevice === d.id}<span class="text-sm text-primary"> (이 기기)</span>{/if}
									<span class="block text-sm text-muted">{d.status === 'active' ? '사용 중' : '만료됨 — 다시 등록 필요'} · 등록 {fmtDateTime(d.createdAt)}</span>
								</span>
								<Button size="sm" variant="ghost" onclick={() => removeDevice(d.id)} disabled={busy === `rm-${d.id}`} aria-label="{d.deviceLabel ?? '기기'} 등록 해제"><Trash size={16} />해제</Button>
							</li>
						{/each}
					</ul>
				{/if}
				{#if support === 'supported'}
					<div class="mt-3">
						<Button onclick={registerDevice} disabled={busy === 'device' || permission === 'denied' || !s.pushConfigured} data-testid="register-device">이 기기 등록</Button>
						<p class="hint mt-1">누르면 브라우저가 알림 권한을 묻습니다. 권한은 이 버튼을 눌렀을 때만 요청합니다.</p>
					</div>
				{/if}
			</div>
			{#if pushMsg}<Notice tone={pushMsg.tone} role={pushMsg.tone === 'danger' ? 'alert' : 'status'}><p>{pushMsg.text}</p></Notice>{/if}
		</section>

		<section class="card" aria-labelledby="test-title">
			<h2 id="test-title" class="section-title flex items-center gap-2"><Send size={20} /> 테스트 알림</h2>
			<p class="mt-1">지금 켜 둔 채널로 테스트 알림을 한 번 보냅니다. 버튼을 누를 때만 보냅니다.</p>
			<div class="mt-3"><Button onclick={sendTest} disabled={busy === 'test' || (!s.emailEnabled && !s.pushEnabled)} data-testid="send-test">테스트 알림 보내기</Button></div>
			{#if !s.emailEnabled && !s.pushEnabled}<p class="hint mt-1">켜진 채널이 없습니다.</p>{/if}
			{#if testMsg}<Notice tone={testMsg.tone} class="mt-3" role={testMsg.tone === 'danger' ? 'alert' : 'status'}><p>{testMsg.text}</p></Notice>{/if}
		</section>

		<section class="card" aria-labelledby="recent-title">
			<h2 id="recent-title" class="section-title">최근 알림</h2>
			{#if recent.length === 0}
				<p class="hint mt-2">보낸 알림이 없습니다.</p>
			{:else}
				<ul class="mt-2 divide-y divide-line-soft" data-testid="recent-notifications">
					{#each recent as n (n.id)}
						{@const st = NOTIFICATION_STATUS[n.status]}
						<li class="flex flex-wrap items-center justify-between gap-2 py-2">
							<span class="min-w-0">
								<span class="block font-semibold break-words">{n.title || NOTIFICATION_EVENT[n.event] || n.event}</span>
								<span class="block text-sm text-muted">{CHANNEL_LABEL[n.channel]} · {fmtDateTime(n.createdAt)}{n.lastError ? ` · ${n.lastError}` : ''}</span>
							</span>
							<span class="flex items-center gap-2">
								<StatusBadge tone={st?.tone ?? 'neutral'} label={st?.label ?? n.status} />
								{#if n.status === 'delivery_failed'}<Button size="sm" onclick={() => resend(n.id)}>다시 보내기</Button>{/if}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="card" aria-labelledby="acct-title">
			<h2 id="acct-title" class="section-title">계정·시간대</h2>
			<dl class="kv mt-3">
				<dt>로그인 계정</dt>
				<dd class="break-all">{me.user.email}</dd>
				<dt>브라우저 시간대</dt>
				<dd>{tz}</dd>
				<dt>계정 시간대</dt>
				<dd>{me.user.timezone ?? '설정 안 됨'} <span class="hint">— 업무마다 계획 화면에서 시간대를 확인합니다.</span></dd>
				<dt>Drive</dt>
				<dd>{me.drive ? `${me.drive.email ?? '연결됨'} (${me.drive.status === 'active' ? '연결됨' : '다시 연결 필요'})` : '연결 안 됨'} · <a href="/files">파일 관리</a></dd>
			</dl>
		</section>
	</div>
</div>

<Modal bind:open={smtpOpen} title="개인 SMTP 발신 프로필 추가" description="저장 전에 실제 SMTP 연결과 로그인을 확인합니다. 비밀번호는 암호화해 저장하며 다시 표시하지 않습니다." variant="full">
	<form id="smtp-form" class="grid gap-3 sm:grid-cols-2" onsubmit={createSmtp}>
		<div class="sm:col-span-2"><label for="smtp-label" class="label">이름</label><input id="smtp-label" class="input" bind:value={smtp.label} required maxlength={100} /></div>
		<div><label for="smtp-host" class="label">SMTP 서버</label><input id="smtp-host" class="input" bind:value={smtp.host} required placeholder="smtp.example.com" autocomplete="off" /></div>
		<div><label for="smtp-port" class="label">포트</label><input id="smtp-port" type="number" class="input" bind:value={smtp.port} min="1" max="65535" required /></div>
		<label class="check-row sm:col-span-2"><input type="checkbox" class="check" bind:checked={smtp.secure} />TLS로 바로 연결 (포트 465)</label>
		<div><label for="smtp-user" class="label">사용자 이름</label><input id="smtp-user" class="input" bind:value={smtp.username} required autocomplete="off" /></div>
		<div><label for="smtp-pass" class="label">비밀번호 / 앱 비밀번호</label><input id="smtp-pass" type="password" class="input" bind:value={smtp.password} required autocomplete="new-password" /></div>
		<div class="sm:col-span-2"><label for="smtp-from" class="label">보내는 주소</label><input id="smtp-from" type="email" class="input" bind:value={smtp.fromAddress} required /></div>
		{#if me.user.role === 'admin'}
			<label class="check-row sm:col-span-2"><input type="checkbox" class="check" bind:checked={smtp.shared} />모든 사용자가 고를 수 있는 공유 프로필로 만들기 (관리자)</label>
		{/if}
		{#if smtpErr}<div class="sm:col-span-2"><Notice tone="danger" role="alert"><p>{smtpErr}</p></Notice></div>{/if}
	</form>
	{#snippet footer()}
		<Button onclick={() => (smtpOpen = false)}>취소</Button>
		<Button type="submit" form="smtp-form" variant="primary" disabled={busy === 'smtp'}>{busy === 'smtp' ? '연결 확인 중…' : '연결 확인 후 추가'}</Button>
	{/snippet}
</Modal>
