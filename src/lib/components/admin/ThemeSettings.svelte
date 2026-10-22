<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ConfirmDialog from '#lib/components/admin/ConfirmDialog.svelte';
	import { apiGet, apiPost, errorText, isOk, objectData, str } from '#lib/components/admin/api';
	import { Badge } from '#lib/components/ui/badge';
	import { Button } from '#lib/components/ui/button';
	import * as Card from '#lib/components/ui/card';
	import { Input } from '#lib/components/ui/input';
	import { Label } from '#lib/components/ui/label';
	import * as Table from '#lib/components/ui/table';

	const themeNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9-_]+[a-zA-Z0-9]$/;

	let loading = $state(true);
	let saving = $state(false);
	let error = $state('');
	let pcTheme = $state('');
	let mobileTheme = $state('');
	let themeName = $state('');
	let themeType = $state('download');
	let themeKey = $state('');
	let themeValue = $state('');
	let confirmDownload = $state(false);

	onMount(() => {
		void load();
	});

	async function load() {
		loading = true;
		error = '';
		try {
			const body = await apiGet('get_themes');
			if (!isOk(body.code)) throw new Error(errorText(body, '主题读取失败'));
			const data = objectData(body);
			if (!data) {
				error = '当前主题配置不是对象，可以在下面重新保存。';
				return;
			}
			pcTheme = str(data, 'pc_theme');
			mobileTheme = str(data, 'mobile_theme');
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '主题读取失败';
		} finally {
			loading = false;
		}
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (!pcTheme.trim() || !mobileTheme.trim()) {
			error = '请填写 PC 主题和手机主题';
			return;
		}
		saving = true;
		try {
			const body = await apiPost('set_theme', {
				value: JSON.stringify({ pc_theme: pcTheme.trim(), mobile_theme: mobileTheme.trim() })
			});
			if (!isOk(body.code)) throw new Error(errorText(body));
			toast.success(typeof body.data === 'string' && body.data ? body.data : '已保存');
			await load();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '保存失败';
		} finally {
			saving = false;
		}
	}

	function askDownload() {
		error = '';
		const name = themeName.trim();
		if (!themeNamePattern.test(name)) {
			error = '主题名称不合法。需要以字母或数字开头和结尾，中间可以有连字符。';
			return;
		}
		confirmDownload = true;
	}

	async function downloadTheme() {
		if (saving) return;
		const name = themeName.trim();
		confirmDownload = false;
		if (!themeNamePattern.test(name)) {
			error = '主题名称不合法。需要以字母或数字开头和结尾，中间可以有连字符。';
			return;
		}
		saving = true;
		error = '';
		try {
			const body = await apiGet('down_theme', {
				name,
				type: themeType.trim() || 'download',
				key: themeKey.trim(),
				value: themeValue.trim()
			});
			if (!isOk(body.code)) throw new Error(errorText(body, '主题下载失败'));
			const message = typeof body.msg === 'string' && body.msg ? body.msg : '主题已下载';
			toast.success(message);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '主题下载失败';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>主题</title>
</svelte:head>

<h1 class="text-xl font-semibold tracking-tight">主题</h1>
<Card.Root size="sm" class="mt-4 max-w-2xl">
	<Card.Content class="grid gap-2 text-sm">
		<p>打开本页只会读取当前的 PC 主题和手机主题。</p>
		<p>下载要再确认一次。确认后才会把主题写入主题目录。</p>
	</Card.Content>
</Card.Root>

{#if loading}<p class="text-muted-foreground mt-4 text-sm">正在读取主题…</p>{/if}
{#if error}<p class="text-destructive mt-4 text-sm" role="alert">{error}</p>{/if}

<Card.Root size="sm" class="mt-4 max-w-2xl">
	<Card.Header>
		<Card.Title>当前主题</Card.Title>
	</Card.Header>
	<Card.Content class="grid gap-4">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>端</Table.Head>
					<Table.Head>主题</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				<Table.Row>
					<Table.Cell>PC</Table.Cell>
					<Table.Cell>
						{#if pcTheme}
							<Badge variant="secondary">{pcTheme}</Badge>
						{:else}
							<span class="text-muted-foreground text-sm">未设置</span>
						{/if}
					</Table.Cell>
				</Table.Row>
				<Table.Row>
					<Table.Cell>手机</Table.Cell>
					<Table.Cell>
						{#if mobileTheme}
							<Badge variant="secondary">{mobileTheme}</Badge>
						{:else}
							<span class="text-muted-foreground text-sm">未设置</span>
						{/if}
					</Table.Cell>
				</Table.Row>
			</Table.Body>
		</Table.Root>
		<form class="grid gap-4" onsubmit={save}>
			<div class="grid gap-1.5">
				<Label for="pc-theme">PC 主题</Label>
				<Input id="pc-theme" bind:value={pcTheme} autocomplete="off" required />
			</div>
			<div class="grid gap-1.5">
				<Label for="mobile-theme">手机主题</Label>
				<Input id="mobile-theme" bind:value={mobileTheme} autocomplete="off" required />
			</div>
			<div class="flex flex-wrap gap-2">
				<Button type="submit" disabled={saving || loading}>{saving ? '保存中…' : '保存主题'}</Button>
				<Button type="button" variant="outline" disabled={saving || loading} onclick={() => void load()}>重新读取</Button>
			</div>
		</form>
	</Card.Content>
</Card.Root>

<Card.Root size="sm" class="mt-4 max-w-2xl">
	<Card.Header>
		<Card.Title>下载主题</Card.Title>
	</Card.Header>
	<Card.Content class="grid gap-4">
		<div class="grid gap-1.5">
			<Label for="theme-name">主题名称</Label>
			<Input id="theme-name" bind:value={themeName} autocomplete="off" placeholder="例如 default2" />
		</div>
		<div class="grid gap-1.5">
			<Label for="theme-type">类型</Label>
			<Input id="theme-type" bind:value={themeType} autocomplete="off" placeholder="download 或 update" />
		</div>
		<div class="grid gap-1.5">
			<Label for="theme-key">key</Label>
			<Input id="theme-key" bind:value={themeKey} autocomplete="off" />
		</div>
		<div class="grid gap-1.5">
			<Label for="theme-value">value</Label>
			<Input id="theme-value" bind:value={themeValue} autocomplete="off" />
		</div>
		<p class="text-muted-foreground text-sm">key 和 value 留空时会按空字符串提交。订阅页校验通过后，可以把那里的 key、value 填过来。</p>
		<Button type="button" disabled={saving} onclick={askDownload}>{saving ? '下载中…' : '下载'}</Button>
	</Card.Content>
</Card.Root>

<ConfirmDialog
	bind:open={confirmDownload}
	title="确认下载主题"
	description={`确认后会下载主题「${themeName.trim()}」（类型 ${themeType.trim() || 'download'}），并写入主题目录。取消则不会下载。`}
	confirmLabel="下载"
	pending={saving}
	onconfirm={downloadTheme}
/>
