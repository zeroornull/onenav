<script lang="ts">
	import { Badge } from '#lib/components/ui/badge';
	import { Button } from '#lib/components/ui/button';

	let { data } = $props();
</script>

<svelte:head>
	<title>{data.title} - {data.siteTitle}</title>
	{#if data.description}
		<meta name="description" content={data.description} />
	{/if}
	<meta name="keywords" content={data.title} />
	{#if data.refreshSeconds != null}
		<meta http-equiv="refresh" content="{data.refreshSeconds};url={data.url}" />
	{/if}
</svelte:head>

<main class="mx-auto w-full max-w-xl px-4 py-10">
	{#if data.ad1}
		<div class="mb-4 text-center">{@html data.ad1}</div>
	{/if}

	<p class="mb-4">
		<a class="text-foreground text-2xl font-semibold no-underline" href="/">{data.siteTitle}</a>
	</p>
	<div class="bg-card rounded-xl p-5 shadow-md dark:shadow-none dark:ring-1 dark:ring-foreground/15">
		<h1 class="text-2xl font-semibold">即将跳转到外部网站</h1>
		<p class="text-muted-foreground mt-2 text-sm">安全性未知，是否继续</p>
		{#if data.refreshSeconds != null}
			<p class="text-muted-foreground mt-1 text-sm">{data.refreshSeconds} 秒后自动打开主链接</p>
		{/if}
		<div class="mt-4 grid gap-2">
			<div class="bg-secondary flex min-w-0 items-center gap-2 rounded-lg px-3 py-2" title="主链接">
				<Badge variant="outline">主链接</Badge>
				<a class="min-w-0 truncate" href={data.url} rel="nofollow">{data.url}</a>
			</div>
			{#if data.urlStandby}
				<div class="bg-secondary flex min-w-0 items-center gap-2 rounded-lg px-3 py-2" title="备用链接">
					<Badge variant="outline">备用链接</Badge>
					<a class="min-w-0 truncate" href={data.urlStandby} rel="nofollow">{data.urlStandby}</a>
				</div>
			{/if}
		</div>
		<div class="mt-4">
			<Button href={data.url} rel="nofollow" class="h-11 px-6">继续前往</Button>
		</div>
	</div>

	{#if data.ad2}
		<div class="mt-4 text-center">{@html data.ad2}</div>
	{/if}
</main>

<style>
	main :global(.ad img),
	main :global(img) {
		max-width: 100%;
	}
</style>
