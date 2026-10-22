<script lang="ts">
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import { Label } from '#lib/components/ui/label';

	let { data, form } = $props();
	const env = $derived(form?.env ?? data.env);
</script>

<svelte:head>
	<title>初始化 OneNav</title>
</svelte:head>

<main class="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-4 py-10">
	<div class="bg-card rounded-xl p-6 shadow-md dark:shadow-none dark:ring-1 dark:ring-foreground/15">
		<h1 class="text-2xl font-semibold">初始化 OneNav</h1>
		<div class="mt-4">
			{#if !env.ok}
				<ul class="mb-4 grid gap-1">
					{#each env.errors as item (item)}
						<li class="text-destructive text-sm" role="alert">{item}</li>
					{/each}
				</ul>
			{/if}
			{#if form?.message}
				<p class="text-destructive mb-4 text-sm" role="alert">{form.message}</p>
			{/if}
			<form method="POST" class="grid gap-4">
				<div class="grid gap-1.5">
					<Label for="username">用户名</Label>
					<Input id="username" name="username" autocomplete="username" placeholder="3-32 位小写字母或数字" class="h-11" />
				</div>
				<div class="grid gap-1.5">
					<Label for="password">密码</Label>
					<Input
						id="password"
						name="password"
						type="password"
						autocomplete="new-password"
						placeholder="6-16 位"
						class="h-11"
					/>
				</div>
				<div class="grid gap-1.5">
					<Label for="password2">确认密码</Label>
					<Input id="password2" name="password2" type="password" autocomplete="new-password" class="h-11" />
				</div>
				<div class="grid gap-1.5">
					<Label for="email">邮箱</Label>
					<Input id="email" name="email" type="email" autocomplete="email" class="h-11" />
				</div>
				<Button type="submit" class="h-11 w-full" disabled={!env.ok}>完成初始化</Button>
			</form>
		</div>
	</div>
</main>
