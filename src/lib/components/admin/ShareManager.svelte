<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ConfirmDialog from '#lib/components/admin/ConfirmDialog.svelte';
	import { Badge } from '#lib/components/ui/badge';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import { Label } from '#lib/components/ui/label';
	import * as Select from '#lib/components/ui/select';
	import * as Table from '#lib/components/ui/table';
	import { Textarea } from '#lib/components/ui/textarea';
	import {
		apiGet,
		apiPost,
		countOf,
		errorText,
		isOk,
		listData,
		num,
		str,
		type Row
	} from '#lib/components/admin/api';

	const pageSize = 20;
	const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

	let rows = $state<Row[]>([]);
	let categories = $state<Row[]>([]);
	let count = $state(0);
	let page = $state(1);
	let loading = $state(true);
	let saving = $state(false);
	let error = $state('');
	let cid = $state('');
	let expire = $state('');
	let password = $state(randomPassword());
	let note = $state('');
	let pendingDelete = $state<Row | null>(null);

	onMount(() => {
		void load();
	});

	function randomPassword(): string {
		let value = '';
		for (let i = 0; i < 4; i += 1) value += alphabet[Math.floor(Math.random() * alphabet.length)];
		return value;
	}

	async function load() {
		loading = true;
		error = '';
		try {
			const [listBody, categoryBody] = await Promise.all([
				apiGet('share_list', { page, limit: pageSize }),
				apiGet('category_list', { page: 1, limit: 500 })
			]);
			if (!isOk(listBody.code)) throw new Error(errorText(listBody, '分享列表加载失败'));
			rows = listData(listBody);
			count = countOf(listBody, rows.length);
			if (isOk(categoryBody.code)) categories = listData(categoryBody);
			else error = errorText(categoryBody, '分类加载失败');
		} catch (cause) {
			rows = [];
			error = cause instanceof Error ? cause.message : '分享列表加载失败';
		} finally {
			loading = false;
		}
	}

	function toSqlTime(value: string): string {
		const normalized = value.trim().replace('T', ' ');
		if (!normalized) return '';
		return normalized.length === 16 ? `${normalized}:00` : normalized;
	}

	async function create(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (!cid || !expire) {
			error = '请选择分类和过期时间';
			return;
		}
		saving = true;
		try {
			const body = await apiPost('create_share', {
				cid: Number(cid),
				expire_time: toSqlTime(expire),
				password,
				note
			});
			if (!isOk(body.code)) throw new Error(errorText(body));
			toast.success('已创建');
			note = '';
			password = randomPassword();
			page = 1;
			await load();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '创建失败';
		} finally {
			saving = false;
		}
	}

	async function confirmRemove() {
		const row = pendingDelete;
		pendingDelete = null;
		if (!row) return;
		const id = num(row, 'id');
		saving = true;
		error = '';
		try {
			const body = await apiGet('del_share', { id });
			if (!isOk(body.code)) throw new Error(errorText(body, '删除失败'));
			toast.success('已删除');
			await load();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '删除失败';
		} finally {
			saving = false;
		}
	}

	function expired(value: string): boolean {
		const time = Date.parse(value.replace(' ', 'T'));
		return Number.isFinite(time) && time < Date.now();
	}

	async function copyShare(row: Row) {
		const sid = str(row, 'sid');
		const text = `链接：${location.origin}/share/${sid} 密码：${str(row, 'password')}`;
		try {
			await navigator.clipboard.writeText(text);
			toast.success('分享链接已复制');
			error = '';
		} catch {
			error = '复制失败，请手动复制 SID';
		}
	}

	function turn(next: number) {
		page = next;
		void load();
	}
</script>

<svelte:head>
	<title>分享</title>
</svelte:head>

<h1 class="text-xl font-semibold tracking-tight">分享</h1>
<p class="text-muted-foreground mt-2 mb-5 text-sm">密码留空则公开访问。复制出的地址是 /share/SID，公开页由分享路由提供。</p>

{#if error}<p class="text-destructive mb-4 text-sm" role="alert">{error}</p>{/if}

<form class="mb-8 grid max-w-2xl gap-4" onsubmit={create}>
	<div class="grid gap-1.5">
		<Label>分类</Label>
		<Select.Root type="single" value={cid} onValueChange={(value) => (cid = value)}>
			<Select.Trigger class="w-full">
				<Select.Value placeholder="请选择要分享的分类" />
			</Select.Trigger>
			<Select.Content>
				{#each categories as item (num(item, 'id'))}
					<Select.Item value={String(num(item, 'id'))} label={str(item, 'name')}>{str(item, 'name')}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>
	<div class="grid gap-1.5">
		<Label for="share-expire">过期时间</Label>
		<Input id="share-expire" type="datetime-local" bind:value={expire} required />
	</div>
	<div class="grid gap-1.5">
		<Label for="share-password">密码</Label>
		<Input id="share-password" bind:value={password} maxlength={16} placeholder="留空则公开" />
	</div>
	<div class="grid gap-1.5">
		<Label for="share-note">备注</Label>
		<Textarea id="share-note" rows={3} bind:value={note}></Textarea>
	</div>
	<div class="flex flex-wrap gap-2">
		<Button type="submit" disabled={saving}>{saving ? '保存中…' : '创建'}</Button>
		<Button type="button" variant="outline" disabled={saving} onclick={() => (password = randomPassword())}>更换密码</Button>
	</div>
</form>

{#if loading}
	<p class="text-muted-foreground text-sm">正在加载分享…</p>
{:else if rows.length === 0}
	{#if !error}<p class="text-muted-foreground text-sm">还没有分享。</p>{/if}
{:else}
	<Table.Root class="min-w-[44rem]">
		<Table.Header>
			<Table.Row>
				<Table.Head>ID</Table.Head>
				<Table.Head>SID</Table.Head>
				<Table.Head>分类</Table.Head>
				<Table.Head>添加时间</Table.Head>
				<Table.Head>过期时间</Table.Head>
				<Table.Head>密码</Table.Head>
				<Table.Head>备注</Table.Head>
				<Table.Head>操作</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each rows as row (num(row, 'id'))}
				<Table.Row>
					<Table.Cell>{num(row, 'id')}</Table.Cell>
					<Table.Cell><a href="/share/{str(row, 'sid')}">{str(row, 'sid')}</a></Table.Cell>
					<Table.Cell>{str(row, 'category_name')}</Table.Cell>
					<Table.Cell>{str(row, 'add_time')}</Table.Cell>
					<Table.Cell>
						<span class="mr-2">{str(row, 'expire_time')}</span>
						{#if expired(str(row, 'expire_time'))}
							<Badge variant="destructive">已过期</Badge>
						{:else}
							<Badge variant="secondary">正常</Badge>
						{/if}
					</Table.Cell>
					<Table.Cell>{str(row, 'password')}</Table.Cell>
					<Table.Cell>{str(row, 'note')}</Table.Cell>
					<Table.Cell>
						<div class="flex flex-wrap gap-2">
							<Button type="button" variant="outline" size="sm" disabled={saving} onclick={() => copyShare(row)}>
								复制链接
							</Button>
							<Button type="button" variant="destructive" size="sm" disabled={saving} onclick={() => (pendingDelete = row)}>
								删除
							</Button>
						</div>
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
	<div class="mt-3 flex flex-wrap items-center gap-2">
		<Button type="button" variant="outline" size="sm" disabled={page <= 1 || loading} onclick={() => turn(page - 1)}>
			上一页
		</Button>
		<span class="text-muted-foreground text-sm">第 {page} 页，共 {count} 条</span>
		<Button type="button" variant="outline" size="sm" disabled={page * pageSize >= count || loading} onclick={() => turn(page + 1)}>
			下一页
		</Button>
	</div>
{/if}

<ConfirmDialog
	open={pendingDelete != null}
	onOpenChange={(next) => {
		if (!next) pendingDelete = null;
	}}
	title="删除分享"
	description="确认删除这条分享？"
	confirmLabel="删除"
	destructive
	pending={saving}
	onconfirm={confirmRemove}
/>
