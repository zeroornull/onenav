<script lang="ts">
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import { Label } from '#lib/components/ui/label';

	let { data, form } = $props();
</script>

<svelte:head>
	<title>登录</title>
</svelte:head>

<main class="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-4 py-10">
	<div class="bg-card rounded-xl p-6 shadow-md dark:shadow-none dark:ring-1 dark:ring-foreground/15">
		<h1 class="text-2xl font-semibold">登录</h1>
		<div class="mt-4">
			{#if !data.installed}
				<p class="mb-4 text-sm">站点还没有配置。<a class="underline" href="/install">去初始化</a></p>
			{/if}
			{#if form?.message}
				<p class="text-destructive mb-4 text-sm" role="alert">{form.message}</p>
			{/if}
			<form method="POST" class="grid gap-4">
				<div class="grid gap-1.5">
					<Label for="user">用户名</Label>
					<Input id="user" name="user" autocomplete="username" class="h-11" />
				</div>
				<div class="grid gap-1.5">
					<Label for="password">密码</Label>
					<Input id="password" name="password" type="password" autocomplete="current-password" class="h-11" />
				</div>
				<Button type="submit" class="h-11 w-full">登录</Button>
			</form>
		</div>
	</div>
</main>
