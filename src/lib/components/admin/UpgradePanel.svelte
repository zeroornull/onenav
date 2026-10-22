<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ConfirmDialog from '#lib/components/admin/ConfirmDialog.svelte';
	import { apiGet, errorText, isOk } from '#lib/components/admin/api';
	import { Badge } from '#lib/components/ui/badge';
	import { Button } from '#lib/components/ui/button';
	import * as Card from '#lib/components/ui/card';
	import { Input } from '#lib/components/ui/input';
	import { Label } from '#lib/components/ui/label';

	let loading = $state(true);
	let saving = $state(false);
	let error = $state('');
	let latestText = $state('');
	let version = $state('');
	let checkOk = $state<boolean | null>(null);
	let checkText = $state('');
	let confirmUpgrade = $state(false);

	onMount(() => {
		void load();
	});

	function comparable(raw: string): string {
		const head = raw.trim().split('-')[0] ?? '';
		return head.replaceAll('v', '');
	}

	async function readLatest(): Promise<string> {
		const latest = await apiGet('get_latest_version');
		if (!isOk(latest.code)) throw new Error(errorText(latest, '读取远程版本失败'));
		latestText = typeof latest.data === 'string' ? latest.data.trim() : '';
		return comparable(latestText);
	}

	async function verify(value: string): Promise<void> {
		const body = await apiGet('check_version', { version: value });
		if (isOk(body.code)) {
			checkOk = true;
			checkText = '当前程序版本与所填版本一致。';
			return;
		}
		checkOk = false;
		checkText = errorText(body, '版本校验未通过');
	}

	async function load() {
		loading = true;
		error = '';
		try {
			const token = await readLatest();
			if (/^[0-9.]+$/.test(token)) version = token;
			if (/^[0-9.]+$/.test(version)) {
				await verify(version);
			} else {
				checkOk = null;
				checkText = latestText ? '远程版本号无法整理成数字版本，可自行填写后再校验。' : '没有拿到远程版本。';
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '版本读取失败';
		} finally {
			loading = false;
		}
	}

	function checkAgain() {
		if (saving || loading) return;
		void (async () => {
			loading = true;
			error = '';
			try {
				const token = await readLatest();
				if (!version.trim() && /^[0-9.]+$/.test(token)) version = token;
				const value = version.trim();
				if (!/^[0-9.]+$/.test(value)) {
					checkOk = null;
					checkText = '请填写数字版本号后再校验。';
					return;
				}
				await verify(value);
			} catch (cause) {
				error = cause instanceof Error ? cause.message : '版本校验失败';
			} finally {
				loading = false;
			}
		})();
	}

	async function runUpgrade() {
		if (saving) return;
		confirmUpgrade = false;
		saving = true;
		error = '';
		try {
			const body = await apiGet('up_updater');
			if (!isOk(body.code)) throw new Error(errorText(body, '升级失败'));
			const message = typeof body.msg === 'string' && body.msg ? body.msg : '升级请求已完成';
			toast.success(message);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '升级失败';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>在线升级</title>
</svelte:head>

<h1 class="text-xl font-semibold tracking-tight">在线升级</h1>
<Card.Root size="sm" class="mt-4 max-w-2xl">
	<Card.Content class="grid gap-2 text-sm">
		<p>打开本页只会读取远程版本，并和当前程序比对。</p>
		<p>升级按钮要再确认一次。确认后会覆盖程序文件。</p>
	</Card.Content>
</Card.Root>

{#if loading}<p class="text-muted-foreground mt-4 text-sm">正在读取版本…</p>{/if}
{#if error}<p class="text-destructive mt-4 text-sm" role="alert">{error}</p>{/if}

<Card.Root size="sm" class="mt-4 max-w-2xl">
	<Card.Header>
		<Card.Title>版本</Card.Title>
	</Card.Header>
	<Card.Content class="grid gap-4">
		<div class="grid gap-1.5">
			<Label for="latest-version">远程版本</Label>
			<Input id="latest-version" readonly value={latestText} placeholder="还没有远程版本" />
		</div>
		<div class="grid gap-1.5">
			<Label for="check-version">用于校验的版本号</Label>
			<Input id="check-version" bind:value={version} inputmode="decimal" autocomplete="off" placeholder="例如 1.2.4" />
		</div>
		<div class="flex flex-wrap items-center gap-2">
			{#if checkOk === true}
				<Badge>一致</Badge>
			{:else if checkOk === false}
				<Badge variant="warning">未通过</Badge>
			{:else}
				<Badge variant="outline">未校验</Badge>
			{/if}
			{#if checkText}<p class="text-sm">{checkText}</p>{/if}
		</div>
		{#if checkOk === false}
			<p class="text-muted-foreground text-sm">这表示当前程序还不是上面的版本号，并不是升级已经开始。</p>
		{/if}
		<Button type="button" variant="outline" disabled={loading || saving} onclick={checkAgain}>检查版本</Button>
	</Card.Content>
</Card.Root>

<div class="mt-4">
	<Button type="button" variant="destructive" disabled={saving} onclick={() => (confirmUpgrade = true)}>
		{saving ? '升级中…' : '升级'}
	</Button>
</div>

<ConfirmDialog
	bind:open={confirmUpgrade}
	title="确认在线升级"
	description="确认后会发起在线升级，并覆盖程序文件。取消则不会发出升级请求。"
	confirmLabel="覆盖并升级"
	destructive
	pending={saving}
	onconfirm={runUpgrade}
/>
