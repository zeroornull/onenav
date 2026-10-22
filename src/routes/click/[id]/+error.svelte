<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button';
</script>

<main class="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-4 py-10">
	<div class="bg-card rounded-xl p-6 shadow-md dark:shadow-none dark:ring-1 dark:ring-foreground/15">
		<h1 class="text-2xl font-semibold">{page.status}</h1>
		<div class="mt-4 grid gap-4">
			<p class="text-sm whitespace-pre-wrap">{page.error?.message ?? '无权访问'}</p>
			<div class="flex flex-wrap gap-2">
				<Button href="/login">登录</Button>
				<Button href="/" variant="outline">返回首页</Button>
			</div>
		</div>
	</div>
</main>
