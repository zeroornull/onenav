<script lang="ts">
	import ArrowDownUpIcon from '@lucide/svelte/icons/arrow-down-up';
	import ArrowUpCircleIcon from '@lucide/svelte/icons/arrow-up-circle';
	import BadgeCheckIcon from '@lucide/svelte/icons/badge-check';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import LinkIcon from '@lucide/svelte/icons/link';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import MenuIcon from '@lucide/svelte/icons/menu';
	import PaletteIcon from '@lucide/svelte/icons/palette';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import ShareIcon from '@lucide/svelte/icons/share-2';
	import TimerIcon from '@lucide/svelte/icons/timer';
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button';
	import { Separator } from '#lib/components/ui/separator';
	import * as Sheet from '#lib/components/ui/sheet';

	let { data, children } = $props();
	let menuOpen = $state(false);

	const links = [
		{ href: '/admin/categories', label: '分类', icon: FolderIcon },
		{ href: '/admin/links', label: '链接', icon: LinkIcon },
		{ href: '/admin/settings', label: '站点设置', icon: SettingsIcon },
		{ href: '/admin/transition', label: '过渡页', icon: TimerIcon },
		{ href: '/admin/io', label: '导入导出', icon: ArrowDownUpIcon },
		{ href: '/admin/shares', label: '分享', icon: ShareIcon },
		{ href: '/admin/subscribe', label: '订阅', icon: BadgeCheckIcon },
		{ href: '/admin/upgrade', label: '在线升级', icon: ArrowUpCircleIcon },
		{ href: '/admin/themes', label: '主题', icon: PaletteIcon },
		{ href: '/admin/sql', label: '任意 SQL', icon: DatabaseIcon }
	];

	const who = $derived(data.user ? `已登录 ${data.user}` : '已登录');
</script>

{#snippet nav(closeOnClick: boolean)}
	<nav class="grid gap-1" aria-label="后台">
		{#each links as link (link.href)}
			<Button
				href={link.href}
				variant="ghost"
				class="h-10 justify-start {page.url.pathname === link.href
					? 'bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
					: ''}"
				aria-current={page.url.pathname === link.href ? 'page' : undefined}
				onclick={() => {
					if (closeOnClick) menuOpen = false;
				}}
			>
				<link.icon />
				{link.label}
			</Button>
		{/each}
		<Button href="/logout" variant="ghost" class="h-10 justify-start">
			<LogOutIcon />
			退出
		</Button>
	</nav>
{/snippet}

<div class="bg-background text-foreground fixed inset-0 flex">
	<aside class="bg-sidebar text-sidebar-foreground border-sidebar-border hidden w-56 shrink-0 flex-col gap-4 overflow-auto border-r px-3 py-4 md:flex">
		<p class="text-muted-foreground px-2.5 text-sm">{who}</p>
		<Separator />
		{@render nav(false)}
	</aside>
	<div class="flex min-w-0 flex-1 flex-col">
		<header class="border-border bg-card flex items-center gap-3 border-b px-3 py-2 md:hidden">
			<Sheet.Root bind:open={menuOpen}>
				<Sheet.Trigger>
					{#snippet child({ props })}
						<Button variant="outline" class="h-11" {...props}>
							<MenuIcon />
							菜单
						</Button>
					{/snippet}
				</Sheet.Trigger>
				<Sheet.Content side="left" class="w-72">
					<Sheet.Header>
						<Sheet.Title>后台</Sheet.Title>
						<Sheet.Description>{who}</Sheet.Description>
					</Sheet.Header>
					{@render nav(true)}
				</Sheet.Content>
			</Sheet.Root>
			<p class="text-muted-foreground truncate text-sm">{who}</p>
		</header>
		<main class="min-h-0 flex-1 overflow-auto px-4 py-5 md:px-6 md:py-6">
			{@render children()}
		</main>
	</div>
</div>
