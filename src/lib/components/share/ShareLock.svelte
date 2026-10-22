<script lang="ts">
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import { Label } from '#lib/components/ui/label';

	let {
		categoryName,
		expireTime
	}: {
		categoryName: string;
		expireTime: string;
	} = $props();
</script>

<h1 class="text-2xl font-semibold">此分享需要密码</h1>
<p class="mt-2 text-sm">分类：{categoryName}</p>
{#if expireTime}
	<p class="text-muted-foreground mt-1 text-sm">到期时间：{expireTime}</p>
{/if}
<form method="POST" class="mt-6 grid max-w-sm gap-4">
	<div class="grid gap-1.5">
		<Label for="share-password">访问密码</Label>
		<Input id="share-password" name="password" type="password" autocomplete="current-password" class="h-11" />
	</div>
	<Button type="submit" class="h-11 w-full">打开分享</Button>
</form>
