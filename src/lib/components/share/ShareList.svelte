<script lang="ts">
	let {
		categoryName,
		expireTime,
		links
	}: {
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
	} = $props();
</script>

<header class="mb-4">
	<h1 class="text-foreground text-2xl font-semibold">{categoryName}</h1>
	{#if expireTime}
		<p class="text-muted-foreground mt-1 text-sm">到期时间：{expireTime}</p>
	{/if}
</header>

{#if links.length === 0}
	<p class="text-muted-foreground text-sm">这个分类没有公开链接。</p>
{:else}
	<ul class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		{#each links as link (link.id)}
			<li class="h-full">
				<a
					class="bg-card text-card-foreground flex h-full items-start gap-3 rounded-xl px-3 py-3 no-underline shadow-sm transition-[transform,box-shadow,background-color] duration-200 ease-out motion-reduce:transition-none motion-reduce:hover:transform-none hover:-translate-y-0.5 hover:shadow-md dark:shadow-none dark:ring-1 dark:ring-foreground/15 dark:hover:shadow-none"
					href={link.href}
					rel="nofollow"
				>
					<span class="bg-secondary flex size-11 shrink-0 items-center justify-center rounded-lg">
						<img src="/ico?text={encodeURIComponent(link.title.trim() || '空')}" alt="" width="24" height="24" class="size-6" />
					</span>
					<span class="grid min-w-0 gap-0.5">
						<span class="font-semibold">{link.title}</span>
						{#if link.description}
							<p class="text-muted-foreground truncate text-sm">{link.description}</p>
						{/if}
						<p class="text-muted-foreground truncate text-sm">{link.url}</p>
						{#if link.urlStandby}
							<p class="text-muted-foreground truncate text-sm">备用：{link.urlStandby}</p>
						{/if}
					</span>
				</a>
			</li>
		{/each}
	</ul>
{/if}
