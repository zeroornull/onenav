<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ConfirmDialog from '#lib/components/admin/ConfirmDialog.svelte';
	import { Badge } from '#lib/components/ui/badge';
	import { Button } from '#lib/components/ui/button';
	import { Checkbox } from '#lib/components/ui/checkbox';
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
		showTime,
		str,
		type Row
	} from '#lib/components/admin/api';

	const pageSize = 20;

	let rows = $state<Row[]>([]);
	let parents = $state<Row[]>([]);
	let count = $state(0);
	let page = $state(1);
	let loading = $state(true);
	let saving = $state(false);
	let error = $state('');

	let editingId = $state<number | null>(null);
	let name = $state('');
	let fontIcon = $state('');
	let fid = $state('0');
	let weight = $state('0');
	let property = $state(false);
	let description = $state('');
	let pendingDelete = $state<Row | null>(null);

	const parentOptions = $derived(parents.filter((item) => num(item, 'id') !== editingId));

	onMount(() => {
		void load();
	});

	async function load() {
		loading = true;
		error = '';
		try {
			const [listBody, parentBody] = await Promise.all([
				apiGet('category_list', { page, limit: pageSize }),
				apiGet('category_list', { page: 1, limit: 500 })
			]);
			if (!isOk(listBody.code)) throw new Error(errorText(listBody, '分类列表加载失败'));
			rows = listData(listBody);
			count = countOf(listBody, rows.length);
			if (isOk(parentBody.code)) {
				parents = listData(parentBody).filter((item) => num(item, 'fid') === 0);
			} else if (!error) {
				error = errorText(parentBody, '父级分类加载失败');
			}
		} catch (cause) {
			rows = [];
			error = cause instanceof Error ? cause.message : '分类列表加载失败';
		} finally {
			loading = false;
		}
	}

	function fill(row: Row) {
		editingId = num(row, 'id');
		name = str(row, 'name');
		fontIcon = str(row, 'font_icon');
		fid = String(num(row, 'fid'));
		weight = String(num(row, 'weight'));
		property = num(row, 'property') === 1;
		description = str(row, 'description');
		error = '';
	}

	function resetForm() {
		editingId = null;
		name = '';
		fontIcon = '';
		fid = '0';
		weight = '0';
		property = false;
		description = '';
	}

	function fields() {
		return {
			name,
			font_icon: fontIcon,
			fid: Number(fid) || 0,
			weight: Number(weight) || 0,
			property: property ? 1 : 0,
			description,
			...(editingId == null ? {} : { id: editingId })
		};
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (!name.trim()) {
			error = '请填写分类名称';
			return;
		}
		saving = true;
		try {
			const method = editingId == null ? 'add_category' : 'edit_category';
			const body = await apiPost(method, fields());
			if (!isOk(body.code)) throw new Error(errorText(body));
			toast.success(editingId == null ? '已添加' : '已修改');
			resetForm();
			await load();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '保存失败';
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
			const body = await apiPost('del_category', { id });
			if (!isOk(body.code)) throw new Error(errorText(body));
			toast.success('已删除');
			if (editingId === id) resetForm();
			await load();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '删除失败';
		} finally {
			saving = false;
		}
	}

	function turn(next: number) {
		page = next;
		void load();
	}
</script>

<svelte:head>
	<title>分类</title>
</svelte:head>

<h1 class="text-xl font-semibold tracking-tight">分类</h1>
<p class="text-muted-foreground mt-2 mb-5 text-sm">权重越大，排序越靠前。私有分类下的链接需要登录后才能查看。</p>

{#if error}<p class="text-destructive mb-4 text-sm" role="alert">{error}</p>{/if}

<form class="mb-8 grid max-w-2xl gap-4" onsubmit={save}>
	<div class="grid gap-1.5">
		<Label for="cat-name">分类名称</Label>
		<Input id="cat-name" bind:value={name} required maxlength={80} />
	</div>
	<div class="grid gap-1.5">
		<Label for="cat-icon">字体图标</Label>
		<Input id="cat-icon" bind:value={fontIcon} placeholder="例如 fa-folder，可留空" />
	</div>
	<div class="grid gap-1.5">
		<Label>父级分类</Label>
		<Select.Root type="single" bind:value={fid}>
			<Select.Trigger class="w-full">
				<Select.Value placeholder="无" />
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="0" label="无">无</Select.Item>
				{#each parentOptions as item (num(item, 'id'))}
					<Select.Item value={String(num(item, 'id'))} label={str(item, 'name')}>{str(item, 'name')}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>
	<div class="grid gap-1.5">
		<Label for="cat-weight">权重</Label>
		<Input id="cat-weight" type="number" min="0" max="999" bind:value={weight} />
	</div>
	<Label class="font-normal">
		<Checkbox bind:checked={property} />
		私有
	</Label>
	<div class="grid gap-1.5">
		<Label for="cat-desc">描述</Label>
		<Textarea id="cat-desc" rows={3} bind:value={description}></Textarea>
	</div>
	<div class="flex flex-wrap gap-2">
		<Button type="submit" disabled={saving}>{saving ? '保存中…' : editingId == null ? '添加' : '保存修改'}</Button>
		{#if editingId != null}
			<Button type="button" variant="outline" disabled={saving} onclick={resetForm}>取消编辑</Button>
		{/if}
	</div>
</form>

{#if loading}
	<p class="text-muted-foreground text-sm">正在加载分类…</p>
{:else if rows.length === 0}
	{#if !error}<p class="text-muted-foreground text-sm">还没有分类。</p>{/if}
{:else}
	<Table.Root class="min-w-[44rem]">
		<Table.Header>
			<Table.Row>
				<Table.Head>名称</Table.Head>
				<Table.Head>父级</Table.Head>
				<Table.Head>私有</Table.Head>
				<Table.Head>权重</Table.Head>
				<Table.Head>链接数</Table.Head>
				<Table.Head>描述</Table.Head>
				<Table.Head>添加时间</Table.Head>
				<Table.Head>操作</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each rows as row (num(row, 'id'))}
				<Table.Row>
					<Table.Cell>{str(row, 'name')}</Table.Cell>
					<Table.Cell>{str(row, 'fname') || '无'}</Table.Cell>
					<Table.Cell>
						{#if num(row, 'property') === 1}
							<Badge variant="warning">是</Badge>
						{:else}
							否
						{/if}
					</Table.Cell>
					<Table.Cell>{num(row, 'weight')}</Table.Cell>
					<Table.Cell>{str(row, 'link_num')}</Table.Cell>
					<Table.Cell>{str(row, 'description')}</Table.Cell>
					<Table.Cell>{showTime(row.add_time)}</Table.Cell>
					<Table.Cell>
						<div class="flex flex-wrap gap-2">
							<Button type="button" variant="outline" size="sm" disabled={saving} onclick={() => fill(row)}>编辑</Button>
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
	title="删除分类"
	description={pendingDelete ? `确认删除分类「${str(pendingDelete, 'name')}」？` : ''}
	confirmLabel="删除"
	destructive
	pending={saving}
	onconfirm={confirmRemove}
/>
