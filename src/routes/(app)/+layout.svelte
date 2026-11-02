<script lang="ts">
	import type { LayoutProps } from './$types';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { House, FolderOpen, Settings, Shield, LogOut, Menu } from '@lucide/svelte';
	import Modal from '#lib/components/Modal.svelte';
	import { api, messageOf } from '#lib/client/api.ts';

	let { data, children }: LayoutProps = $props();
	const me = $derived(data.me);
	let menuOpen = $state(false);
	let logoutError = $state('');

	const nav = $derived([
		{ href: '/', label: '홈', icon: House },
		{ href: '/files', label: '허용한 파일', icon: FolderOpen },
		{ href: '/settings', label: '알림·설정', icon: Settings },
		...(me.user.role === 'admin' ? [{ href: '/admin', label: '관리', icon: Shield }] : [])
	]);

	function isCurrent(href: string) {
		const p = page.url.pathname;
		if (href === '/') return p === '/' || p.startsWith('/drafts') || p.startsWith('/tasks') || p.startsWith('/runs');
		return p === href || p.startsWith(href + '/');
	}

	afterNavigate(() => {
		menuOpen = false;
	});

	async function logout() {
		logoutError = '';
		try {
			await api('/auth/logout', { method: 'POST' });
			window.location.assign('/login');
		} catch (e) {
			logoutError = messageOf(e);
		}
	}
</script>

{#snippet navList(idPrefix: string)}
	<nav aria-label="주 메뉴">
		<ul class="space-y-1">
			{#each nav as item (item.href)}
				<li>
					<a
						href={item.href}
						id="{idPrefix}-{item.href.replace(/\W/g, '') || 'home'}"
						aria-current={isCurrent(item.href) ? 'page' : undefined}
						class="flex min-h-11 items-center gap-3 rounded-[8px] px-3 font-semibold no-underline {isCurrent(item.href) ? 'bg-primary-soft text-primary' : 'text-ink hover:bg-subtle hover:text-ink'}"
					>
						<item.icon size={20} />
						<span>{item.label}</span>
					</a>
				</li>
			{/each}
		</ul>
	</nav>
{/snippet}

{#snippet account()}
	<div class="border-t border-line-soft pt-3">
		<p class="truncate px-3 text-sm font-semibold" title={me.user.email}>{me.user.name ?? me.user.email}</p>
		<p class="truncate px-3 text-sm text-muted">{me.user.email}{me.user.role === 'admin' ? ' · 관리자' : ''}</p>
		<button type="button" onclick={logout} class="mt-2 flex min-h-11 w-full items-center gap-3 rounded-[8px] px-3 text-left font-semibold text-ink hover:bg-subtle">
			<LogOut size={20} />
			<span>로그아웃</span>
		</button>
		{#if logoutError}<p class="px-3 text-sm text-danger" role="alert">{logoutError}</p>{/if}
	</div>
{/snippet}

<a href="#main" class="sr-only z-50 rounded-[8px] bg-primary px-4 py-3 font-semibold text-primary-fg focus:not-sr-only focus:fixed focus:top-2 focus:left-2">본문으로 건너뛰기</a>

<div class="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
	<!-- Desktop navigation -->
	<aside class="hidden border-r border-line bg-surface lg:block">
		<div class="sticky top-0 flex h-dvh flex-col gap-4 p-4">
			<a href="/" class="flex min-h-11 items-center gap-2 px-3 text-lg font-bold text-ink no-underline">
				<img src="/icon.svg" alt="" width="28" height="28" />
				<span>Yeeun</span>
			</a>
			<div class="flex-1 overflow-y-auto">{@render navList('d')}</div>
			{@render account()}
		</div>
	</aside>

	<div class="min-w-0">
		<!-- Mobile / tablet top bar -->
		<header class="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-surface px-2 py-1 lg:hidden">
			<button type="button" class="inline-flex size-11 items-center justify-center rounded-[8px] hover:bg-subtle" aria-label="메뉴 열기" aria-expanded={menuOpen} onclick={() => (menuOpen = true)} data-testid="menu-button">
				<Menu size={24} />
			</button>
			<a href="/" class="flex min-h-11 items-center gap-2 font-bold text-ink no-underline">
				<img src="/icon.svg" alt="" width="24" height="24" />
				<span>Yeeun</span>
			</a>
			<span class="size-11" aria-hidden="true"></span>
		</header>

		<main id="main" tabindex="-1" class="mx-auto w-full max-w-[96rem] min-w-0 px-4 py-5 outline-none md:px-6 md:py-6 lg:px-8">
			{@render children()}
		</main>
	</div>
</div>

<Modal bind:open={menuOpen} title="메뉴" variant="drawer">
	<div class="flex h-full flex-col gap-4">
		<div class="flex-1">{@render navList('m')}</div>
		{@render account()}
	</div>
</Modal>
