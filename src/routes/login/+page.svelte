<script lang="ts">
	import { page } from '$app/state';
	import Notice from '#lib/components/Notice.svelte';

	const ERRORS: Record<string, { title: string; body: string }> = {
		NOT_CONFIGURED: { title: 'Google 로그인이 아직 설정되지 않았습니다', body: '운영자가 Google OAuth 클라이언트를 설정해야 로그인할 수 있습니다. 관리자에게 문의하세요.' },
		INVITATION_REQUIRED: { title: '초대되지 않은 계정입니다', body: '이 서비스는 관리자가 초대한 Google 계정만 사용할 수 있습니다. 초대받은 계정으로 다시 로그인하거나 관리자에게 초대를 요청하세요.' },
		AUTH_REQUIRED: { title: '로그인을 완료하지 못했습니다', body: '로그인 시간이 지났거나 취소되었습니다. 다시 시도하세요.' }
	};
	const code = $derived(page.url.searchParams.get('error'));
	const err = $derived(code ? (ERRORS[code] ?? ERRORS.AUTH_REQUIRED) : null);
</script>

<svelte:head>
	<title>로그인 · Yeeun</title>
</svelte:head>

<main id="main" class="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-4 py-10">
	<div class="mb-6 flex items-center gap-3">
		<img src="/icon.svg" alt="" width="40" height="40" />
		<span class="text-xl font-bold">Yeeun</span>
	</div>

	<div class="card space-y-5">
		<div>
			<h1 class="text-2xl font-bold">로그인</h1>
			<p class="mt-2 text-muted">
				직접 허용한 Google Drive 파일을 자연어로 요청한 대로 정리합니다. 같은 원본을 Claude와 Codex가 각각 분석하고, 두 결과와 코드 검산이 일치할 때만 결과를 확정합니다.
			</p>
		</div>

		{#if err}
			<Notice tone="danger" title={err.title} role="alert" testid="login-error">
				<p>{err.body}</p>
			</Notice>
		{/if}

		<a
			href="/auth/google/start"
			class="flex min-h-12 w-full items-center justify-center gap-3 rounded-[8px] border border-[#94a3b8] bg-surface px-4 py-2 font-semibold text-ink no-underline hover:bg-subtle hover:text-ink"
			data-sveltekit-reload
		>
			<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
				<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
				<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
				<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
				<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
			</svg>
			<span>Google 계정으로 로그인</span>
		</a>

		<section aria-labelledby="notice-title" class="space-y-2 rounded-[8px] bg-subtle p-4 text-[0.9375rem]">
			<h2 id="notice-title" class="font-semibold">사용 전 확인하세요</h2>
			<ul class="list-disc space-y-1 pl-5">
				<li>관리자가 초대한 Google 계정만 로그인할 수 있습니다.</li>
				<li>로그인은 본인 확인용입니다. Drive 파일은 로그인 뒤 <strong>직접 고른 파일만</strong> 따로 허용합니다. 전체 Drive를 검색하지 않습니다.</li>
				<li>분석은 서비스 소유자의 Claude·Codex <strong>구독</strong>으로 실행되며 사용량 한도를 모든 사용자가 함께 씁니다. 한도에 닿으면 API 과금으로 바꾸지 않고 오류로 알립니다.</li>
				<li>원본 파일은 수정하지 않습니다. 결과 파일은 새 복사본으로 만듭니다.</li>
			</ul>
		</section>
	</div>
</main>
