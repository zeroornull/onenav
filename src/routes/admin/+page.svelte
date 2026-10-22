<script lang="ts">
	import { Button } from '#lib/components/ui/button';

	let { data } = $props();
</script>

<svelte:head>
	<title>后台</title>
</svelte:head>

<h1 class="text-2xl font-semibold">后台</h1>
<p class="text-muted-foreground mt-2 text-sm">{data.user ? `${data.user}，从左侧进入各项管理。` : '从左侧进入各项管理。'}</p>
<nav class="mt-6 grid max-w-sm gap-2" aria-label="管理入口">
	<Button href="/admin/categories" variant="outline" class="h-11 justify-start bg-card">分类</Button>
	<Button href="/admin/links" variant="outline" class="h-11 justify-start bg-card">链接</Button>
	<Button href="/admin/settings" variant="outline" class="h-11 justify-start bg-card">站点设置</Button>
	<Button href="/admin/transition" variant="outline" class="h-11 justify-start bg-card">过渡页</Button>
	<Button href="/admin/io" variant="outline" class="h-11 justify-start bg-card">导入导出</Button>
	<Button href="/admin/shares" variant="outline" class="h-11 justify-start bg-card">分享</Button>
	<Button href="/admin/subscribe" variant="outline" class="h-11 justify-start bg-card">订阅</Button>
	<Button href="/admin/upgrade" variant="outline" class="h-11 justify-start bg-card">在线升级</Button>
	<Button href="/admin/themes" variant="outline" class="h-11 justify-start bg-card">主题</Button>
	<Button href="/admin/sql" variant="outline" class="h-11 justify-start bg-card">任意 SQL</Button>
</nav>
