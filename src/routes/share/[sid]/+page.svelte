<script lang="ts">
	import { Button } from '#lib/components/ui/button';
	import ShareList from '#lib/components/share/ShareList.svelte';
	import ShareLock from '#lib/components/share/ShareLock.svelte';

	let { data, form } = $props();

	const opened = $derived(asReady(form) ?? asReady(data));

	function asReady(value: unknown): {
		categoryName: string;
		expireTime: string;
		links: {
			id: number;
			title: string;
			url: string;
			description: string | null;
			urlStandby: string | null;
			href: string;
		}[];
	} | null {
		if (!value || typeof value !== 'object') return null;
		const record = value as Record<string, unknown>;
		if (record.kind !== 'ready' || typeof record.categoryName !== 'string' || !Array.isArray(record.links)) {
			return null;
		}
		return {
			categoryName: record.categoryName,
			expireTime: typeof record.expireTime === 'string' ? record.expireTime : '',
			links: record.links
		};
	}
</script>

<svelte:head>
	<title>{opened ? `${opened.categoryName} - 分享` : '分享'}</title>
</svelte:head>

<main class="mx-auto w-full max-w-3xl px-4 py-8">
	{#if opened}
		<ShareList categoryName={opened.categoryName} expireTime={opened.expireTime} links={opened.links} />
	{:else if data.kind === 'locked'}
		<div class="bg-card rounded-xl p-6 shadow-md dark:shadow-none dark:ring-1 dark:ring-foreground/15">
			{#if form && 'message' in form && form.message}
				<p class="text-destructive mb-4 text-sm" role="alert">{form.message}</p>
			{/if}
			<ShareLock categoryName={data.categoryName} expireTime={data.expireTime} />
		</div>
	{:else if data.kind === 'expired'}
		<h1 class="text-2xl font-semibold">链接已过期！</h1>
		<p class="text-muted-foreground mt-2 text-sm">到期时间：{data.expireTime || '未知'}</p>
		<Button href="/" variant="outline" class="mt-6">返回首页</Button>
	{:else if data.kind === 'missing'}
		<h1 class="text-2xl font-semibold">SID不存在！</h1>
		<Button href="/" variant="outline" class="mt-6">返回首页</Button>
	{:else}
		<h1 class="text-2xl font-semibold">SID不合法！</h1>
		<p class="text-muted-foreground mt-2 text-sm">分享编号需要是 8 位字母或数字。</p>
		<Button href="/" variant="outline" class="mt-6">返回首页</Button>
	{/if}
</main>
