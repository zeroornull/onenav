<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { page } from '$app/state';
	import ConfirmDialog from '#lib/components/admin/ConfirmDialog.svelte';
	import { apiGet, apiPost, errorText, isOk, objectData, showTime, str, type ApiBody, type Row } from '#lib/components/admin/api';
	import { Badge } from '#lib/components/ui/badge';
	import { Button } from '#lib/components/ui/button';
	import * as Card from '#lib/components/ui/card';
	import { Input } from '#lib/components/ui/input';
	import { Label } from '#lib/components/ui/label';
	import * as Table from '#lib/components/ui/table';

	let loading = $state(true);
	let saving = $state(false);
	let error = $state('');
	let active = $state(false);
	let statusMessage = $state('');
	let checkMessage = $state('');
	let detail = $state<Row | null>(null);
	let orderId = $state('');
	let email = $state('');
	let endTime = $state('');
	let confirmClear = $state(false);

	const host = $derived(page.url.host);

	onMount(() => {
		void load();
	});

	async function load() {
		loading = true;
		error = '';
		try {
			const [statusBody, checkBody] = await Promise.all([
				apiGet('get_subscribe_status'),
				apiGet('check_subscribe')
			]);
			active = isOk(statusBody.code) && statusBody.data === 'Active';
			statusMessage = active ? '订阅有效' : statusLabel(statusBody);
			if (isOk(checkBody.code)) {
				checkMessage = '远程校验通过';
				detail = objectData(checkBody);
				fillEmpty(detail);
			} else {
				checkMessage = errorText(checkBody, '订阅校验未通过');
				detail = null;
			}
		} catch (cause) {
			active = false;
			detail = null;
			statusMessage = '';
			checkMessage = '';
			error = cause instanceof Error ? cause.message : '订阅状态读取失败';
		} finally {
			loading = false;
		}
	}

	function statusLabel(body: ApiBody): string {
		const text = errorText(body, '订阅未生效');
		return text === 'failure' ? '订阅未生效' : text;
	}

	function fillEmpty(row: Row | null) {
		if (!row) return;
		if (!orderId) orderId = str(row, 'order_id');
		if (!email) email = str(row, 'email');
		if (!endTime) endTime = str(row, 'end_time');
	}

	function detailRows(row: Row | null): { label: string; value: string }[] {
		if (!row) return [];
		const labels: Record<string, string> = {
			order_id: '订单号',
			email: '邮箱',
			domain: '域名',
			end_time: '到期时间',
			key: 'key',
			value: 'value'
		};
		const rows: { label: string; value: string }[] = [];
		for (const key of Object.keys(labels)) {
			const value = str(row, key);
			if (!value) continue;
			if (key === 'end_time') {
				const shown = showTime(value);
				rows.push({ label: labels[key], value: shown && shown !== value ? `${value}（${shown}）` : value });
			} else {
				rows.push({ label: labels[key], value });
			}
		}
		return rows;
	}

	const remoteRows = $derived(detailRows(detail));

	async function save(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (!orderId.trim() || !email.trim()) {
			error = '请填写订单号和订阅邮箱';
			return;
		}
		saving = true;
		try {
			const body = await apiPost('set_subscribe', {
				order_id: orderId.trim(),
				email: email.trim(),
				end_time: endTime.trim()
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

	async function clearSubscribe() {
		confirmClear = false;
		saving = true;
		error = '';
		try {
			const body = await apiPost('set_subscribe', { order_id: '', email: '', end_time: '' });
			if (!isOk(body.code)) throw new Error(errorText(body));
			orderId = '';
			email = '';
			endTime = '';
			toast.success(typeof body.data === 'string' && body.data ? body.data : '订阅已删除');
			await load();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '删除失败';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>订阅</title>
</svelte:head>

<h1 class="text-xl font-semibold tracking-tight">订阅</h1>
<Card.Root size="sm" class="mt-4 max-w-2xl">
	<Card.Content class="grid gap-2 text-sm">
		<p>保存订单号和邮箱后，才能使用在线升级和主题下载。检查只会向订阅服务查询。</p>
		<p>当前访问域名是 <strong>{host}</strong>。购买或修改订阅时要填这个域名。</p>
	</Card.Content>
</Card.Root>

{#if loading}<p class="text-muted-foreground mt-4 text-sm">正在读取订阅状态…</p>{/if}
{#if error}<p class="text-destructive mt-4 text-sm" role="alert">{error}</p>{/if}

<Card.Root size="sm" class="mt-4 max-w-2xl">
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			状态
			{#if !loading}
				<Badge variant={active ? 'default' : 'secondary'}>{active ? '有效' : '未生效'}</Badge>
			{/if}
		</Card.Title>
	</Card.Header>
	<Card.Content class="grid gap-3">
		{#if statusMessage}<p class="text-sm">{statusMessage}</p>{/if}
		{#if checkMessage}<p class="text-muted-foreground text-sm">{checkMessage}</p>{/if}
		{#if remoteRows.length > 0}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>项目</Table.Head>
						<Table.Head>内容</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each remoteRows as row (row.label)}
						<Table.Row>
							<Table.Cell>{row.label}</Table.Cell>
							<Table.Cell class="break-all">{row.value}</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{:else if !loading && !error}
			<p class="text-muted-foreground text-sm">远程校验没有返回订阅明细。</p>
		{/if}
		<Button type="button" variant="outline" disabled={loading || saving} onclick={() => void load()}>重新检查</Button>
	</Card.Content>
</Card.Root>

<form class="mt-4 grid max-w-2xl gap-4" onsubmit={save}>
	<div class="grid gap-1.5">
		<Label for="subscribe-order">订单号</Label>
		<Input id="subscribe-order" bind:value={orderId} autocomplete="off" required />
	</div>
	<div class="grid gap-1.5">
		<Label for="subscribe-email">订阅邮箱</Label>
		<Input id="subscribe-email" type="email" bind:value={email} autocomplete="off" required />
	</div>
	<div class="grid gap-1.5">
		<Label for="subscribe-end">到期时间</Label>
		<Input id="subscribe-end" bind:value={endTime} autocomplete="off" placeholder="按原样保存，通常是 Unix 秒" />
		<p class="text-muted-foreground text-sm">订阅是否有效以远程校验为准。这里的到期时间只是一并写入。</p>
	</div>
	<div class="flex flex-wrap gap-2">
		<Button type="submit" disabled={saving || loading}>{saving ? '保存中…' : '保存订阅'}</Button>
		<Button type="button" variant="destructive" disabled={saving || loading} onclick={() => (confirmClear = true)}>
			删除订阅
		</Button>
	</div>
</form>

<ConfirmDialog
	bind:open={confirmClear}
	title="删除订阅"
	description="确认后会清空订单号、邮箱和到期时间。取消则不会修改。"
	confirmLabel="删除"
	destructive
	pending={saving}
	onconfirm={clearSubscribe}
/>
