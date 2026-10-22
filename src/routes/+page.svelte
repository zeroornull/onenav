<script lang="ts">
	import { Button } from '#lib/components/ui/button';
	import CategoryGroup from '#lib/components/home/CategoryGroup.svelte';
	import SiteHeader from '#lib/components/home/SiteHeader.svelte';

	let { data } = $props();
	let keyword = $state('');

	const visible = $derived.by(() => {
		const needle = keyword.trim().toLowerCase();
		if (!needle) return data.categories;
		return data.categories
			.map((category) => ({
				...category,
				links: category.links.filter((link) =>
					[link.title, link.description ?? '', link.url].join('\n').toLowerCase().includes(needle)
				)
			}))
			.filter((category) => category.links.length > 0);
	});
</script>

<svelte:head>
	<title>{data.siteTitle}</title>
	{#if data.siteDescription}
		<meta name="description" content={data.siteDescription} />
	{/if}
	{#if data.siteKeywords}
		<meta name="keywords" content={data.siteKeywords} />
	{/if}
</svelte:head>

<div class="bg-background min-h-svh">
	<SiteHeader
		bind:keyword
		siteTitle={data.siteTitle}
		siteSubtitle={data.siteSubtitle}
		loggedIn={data.loggedIn}
		user={data.user}
		cid={data.cid}
	/>

	<div class="mx-auto w-full max-w-[100rem] px-4 pt-5 pb-16 md:px-6">
	{#if data.categories.length > 0}
		<nav class="flex gap-2 overflow-x-auto pb-1" aria-label="分类">
			<Button
				href="/"
				variant={data.cid == null ? 'default' : 'secondary'}
				class="h-10 shrink-0 rounded-full px-4"
			>
				全部分类
			</Button>
			{#each data.categories as category (category.id)}
				<Button
					href="/?cid={category.id}"
					variant={data.cid === category.id ? 'default' : 'secondary'}
					class="h-10 shrink-0 rounded-full px-4"
				>
					{category.name}
				</Button>
			{/each}
		</nav>
	{/if}

	{#if visible.length === 0}
		<p class="text-muted-foreground mt-8 text-sm">{keyword.trim() ? '没有匹配的书签。' : '没有可显示的分类。'}</p>
	{:else}
		{#each visible as category (category.id)}
			<CategoryGroup
				{category}
				links={category.links}
				showPrivate={data.loggedIn}
				editable={data.loggedIn}
				reorderable={data.loggedIn && keyword.trim() === ''}
			/>
		{/each}
	{/if}
	</div>
</div>
