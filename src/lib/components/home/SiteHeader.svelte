<script lang="ts">
	import SearchIcon from '@lucide/svelte/icons/search';
	import { Button } from '#lib/components/ui/button';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu';
	import { Input } from '#lib/components/ui/input';
	import { Label } from '#lib/components/ui/label';

	let {
		keyword = $bindable(''),
		siteTitle,
		siteSubtitle,
		loggedIn,
		user,
		cid
	}: {
		keyword?: string;
		siteTitle: string;
		siteSubtitle: string;
		loggedIn: boolean;
		user: string | null;
		cid: number | null;
	} = $props();
</script>

<header class="bg-card sticky top-0 z-30 border-b border-border">
	<div class="mx-auto flex w-full max-w-[100rem] flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 md:px-6">
	<div class="min-w-0 flex-1 sm:flex-none">
		<h1 class="text-2xl font-semibold">
			<a class="text-foreground no-underline" href="/">{siteTitle}</a>
		</h1>
		{#if siteSubtitle}
			<p class="text-muted-foreground mt-1 text-sm">{siteSubtitle}</p>
		{/if}
	</div>
	<div class="order-last grid w-full gap-1.5 sm:order-none sm:w-auto sm:min-w-64 sm:flex-1">
		<Label for="site-search">搜索</Label>
		<div class="relative">
			<SearchIcon class="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2" />
			<Input
				id="site-search"
				class="h-11 rounded-full border-transparent bg-secondary pl-10 shadow-none"
				bind:value={keyword}
				type="search"
				placeholder="搜索标题、描述或网址"
				autocomplete="off"
			/>
		</div>
	</div>
	<nav class="flex shrink-0 flex-wrap items-center gap-2" aria-label="账户">
		{#if cid != null}
			<Button href="/" variant="outline" class="h-11">全部分类</Button>
		{/if}
		{#if loggedIn}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button variant="outline" class="h-11" {...props}>{user || '账户'}</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end">
					<DropdownMenu.Item>
						{#snippet child({ props })}
							<a href="/admin" {...props}>后台</a>
						{/snippet}
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
					<DropdownMenu.Item>
						{#snippet child({ props })}
							<a href="/logout" {...props}>退出</a>
						{/snippet}
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{:else}
			<Button href="/login" class="h-11">登录</Button>
		{/if}
	</nav>
	</div>
</header>
