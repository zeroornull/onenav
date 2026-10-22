<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ConfirmDialog from '#lib/components/admin/ConfirmDialog.svelte';
	import { Badge } from '#lib/components/ui/badge';
	import { Button } from '#lib/components/ui/button';
	import * as Card from '#lib/components/ui/card';
	import { Checkbox } from '#lib/components/ui/checkbox';
	import { Input } from '#lib/components/ui/input';
	import { Label } from '#lib/components/ui/label';
	import * as Select from '#lib/components/ui/select';
	import * as Table from '#lib/components/ui/table';
	import { Textarea } from '#lib/components/ui/textarea';
	import {
		apiGet,
		apiPost,
		apiUpload,
		countOf,
		errorText,
		fileNameOf,
		isOk,
		listData,
		num,
		str,
		type Row
	} from '#lib/components/admin/api';

	const pageSize = 20;

	let rows = $state<Row[]>([]);
	let categories = $state<Row[]>([]);
	let count = $state(0);
	let page = $state(1);
	let loading = $state(true);
	let saving = $state(false);
	let error = $state('');
	let selected = $state<number[]>([]);
	let batchFid = $state('');

	let editingId = $state<number | null>(null);
	let title = $state('');
	let url = $state('');
	let urlStandby = $state('');
	let description = $state('');
	let fid = $state('');
	let property = $state(false);
	let weight = $state('0');
	let fontIcon = $state('');
	let pendingDelete = $state<Row | null>(null);
	let confirmBatch = $state(false);

	const pageIds = $derived(rows.map((row) => num(row, 'id')));
	const allOnPage = $derived(pageIds.length > 0 && pageIds.every((id) => selected.includes(id)));
	const someOnPage = $derived(pageIds.some((id) => selected.includes(id)));

	onMount(() => {
		void load();
	});

	async function load() {
		loading = true;
		error = '';
		try {
			const [listBody, categoryBody] = await Promise.all([
				apiPost('link_list', { page, limit: pageSize }),
				apiGet('category_list', { page: 1, limit: 500 })
			]);
			if (!isOk(listBody.code)) throw new Error(errorText(listBody, '链接列表加载失败'));
			rows = listData(listBody);
			count = countOf(listBody, rows.length);
			selected = [];
			if (isOk(categoryBody.code)) categories = listData(categoryBody);
			else error = errorText(categoryBody, '分类加载失败');
		} catch (cause) {
			rows = [];
			error = cause instanceof Error ? cause.message : '链接列表加载失败';
		} finally {
			loading = false;
		}
	}

	function fill(row: Row) {
		editingId = num(row, 'id');
		title = str(row, 'title');
		url = str(row, 'url');
		urlStandby = str(row, 'url_standby');
		description = str(row, 'description');
		fid = String(num(row, 'fid'));
		property = num(row, 'property') === 1;
		weight = String(num(row, 'weight'));
		fontIcon = str(row, 'font_icon');
		error = '';
	}

	function resetForm() {
		editingId = null;
		title = '';
		url = '';
		urlStandby = '';
		description = '';
		fid = '';
		property = false;
		weight = '0';
		fontIcon = '';
	}

	function fields() {
		return {
			title,
			url,
			url_standby: urlStandby,
			description,
			fid: Number(fid) || 0,
			property: property ? 1 : 0,
			weight: Number(weight) || 0,
			font_icon: fontIcon,
			...(editingId == null ? {} : { id: editingId })
		};
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (!title.trim() || !url.trim() || !fid) {
			error = '请填写标题、URL 和分类';
			return;
		}
		saving = true;
		try {
			const method = editingId == null ? 'add_link' : 'edit_link?type=console';
			const body = await apiPost(method, fields());
			if (!isOk(body.code)) throw new Error(errorText(body));
			toast.success(editingId == null ? '已添加' : '已更新');
			resetForm();
			await load();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '保存失败';
		} finally {
			saving = false;
		}
	}

	async function recognize() {
		error = '';
		if (!url.trim()) {
			error = '请先填写 URL';
			return;
		}
		saving = true;
		try {
			const body = await apiPost('get_link_info', { url });
			if (!isOk(body.code)) throw new Error(errorText(body));
			const data = body.data;
			if (data && typeof data === 'object' && !Array.isArray(data)) {
				const record = data as Row;
				if (record.title != null) title = String(record.title);
				if (record.description != null) description = String(record.description);
			}
			toast.success('已填入识别到的标题和描述');
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '识别失败';
		} finally {
			saving = false;
		}
	}

	async function uploadIcon(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		saving = true;
		error = '';
		try {
			const body = await apiUpload('uploadImages', file, {
				icon_name: Math.random().toString(36).slice(2, 8),
				old_pic: fontIcon
			});
			if (!isOk(body.code)) throw new Error(errorText(body));
			const name = fileNameOf(body);
			if (!name) throw new Error('上传成功但没有返回图标路径');
			fontIcon = name;
			toast.success('图标已上传，保存链接后才会写入');
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '图标上传失败';
		} finally {
			saving = false;
		}
	}

	async function removeIcon() {
		error = '';
		if (!fontIcon) {
			toast.success('图标为空，无需删除');
			return;
		}
		if (fontIcon.includes('http')) {
			fontIcon = '';
			toast.success('图标已清空，请保存');
			return;
		}
		saving = true;
		try {
			const body = await apiPost('del_link_icon', { icon_path: fontIcon });
			if (!isOk(body.code)) throw new Error(errorText(body));
			fontIcon = '';
			toast.success('图标已删除，请保存');
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '删除图标失败';
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
			const body = await apiPost('del_link', { id });
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

	function toggle(id: number, on: boolean) {
		selected = on ? [...selected, id] : selected.filter((item) => item !== id);
	}

	function togglePage(on: boolean) {
		const ids = rows.map((row) => num(row, 'id'));
		selected = on ? [...new Set([...selected, ...ids])] : selected.filter((id) => !ids.includes(id));
	}

	function askBatch() {
		error = '';
		if (selected.length === 0) {
			error = '请先选择链接';
			return;
		}
		if (!batchFid) {
			error = '请先选择分类';
			return;
		}
		confirmBatch = true;
	}

	async function confirmBatchCategory() {
		confirmBatch = false;
		saving = true;
		error = '';
		try {
			const body = await apiPost('batch_modify_category', { id: selected, fid: Number(batchFid) });
			if (!isOk(body.code)) throw new Error(errorText(body));
			toast.success('分类已修改');
			await load();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '批量修改分类失败';
		} finally {
			saving = false;
		}
	}

	async function batchProperty(next: 0 | 1) {
		error = '';
		if (selected.length === 0) {
			error = '请先选择链接';
			return;
		}
		saving = true;
		try {
			const body = await apiPost('set_link_attribute', { ids: selected, property: next });
			if (!isOk(body.code)) throw new Error(errorText(body, '设置失败'));
			toast.success(next === 1 ? '已设为私有' : '已设为公开');
			await load();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '批量设置失败';
		} finally {
			saving = false;
		}
	}

	function iconSrc(value: string): string {
		if (!value) return '';
		if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/')) return value;
		return `/${value}`;
	}

	function turn(next: number) {
		page = next;
		void load();
	}

	const batchLabel = $derived(categories.find((item) => String(num(item, 'id')) === batchFid));
</script>

<svelte:head>
	<title>链接</title>
</svelte:head>

<h1 class="text-xl font-semibold tracking-tight">链接</h1>
<p class="text-muted-foreground mt-2 mb-5 text-sm">权重越大，排序越靠前。私有链接需要登录后才能查看。</p>

{#if error}<p class="text-destructive mb-4 text-sm" role="alert">{error}</p>{/if}

<form class="mb-6 grid max-w-2xl gap-4" onsubmit={save}>
	<div class="grid gap-1.5">
		<Label for="link-title">标题</Label>
		<Input id="link-title" bind:value={title} required />
	</div>
	<div class="grid gap-1.5">
		<Label for="link-url">URL</Label>
		<Input id="link-url" bind:value={url} required placeholder="https://" />
	</div>
	<div class="grid gap-1.5">
		<Label for="link-standby">备用 URL</Label>
		<Input id="link-standby" bind:value={urlStandby} placeholder="没有可留空" />
	</div>
	<div class="grid gap-1.5">
		<Label for="link-desc">描述</Label>
		<Textarea id="link-desc" rows={3} bind:value={description}></Textarea>
	</div>
	<div class="grid gap-1.5">
		<Label>分类</Label>
		<Select.Root type="single" value={fid} onValueChange={(value) => (fid = value)}>
			<Select.Trigger class="w-full">
				<Select.Value placeholder="请选择分类" />
			</Select.Trigger>
			<Select.Content>
				{#each categories as item (num(item, 'id'))}
					<Select.Item value={String(num(item, 'id'))} label={str(item, 'name')}>{str(item, 'name')}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>
	<Label class="font-normal">
		<Checkbox bind:checked={property} />
		私有
	</Label>
	<div class="grid gap-1.5">
		<Label for="link-weight">权重</Label>
		<Input id="link-weight" type="number" min="0" max="999" bind:value={weight} />
	</div>
	<div class="grid gap-1.5">
		<Label for="link-icon">图标</Label>
		<Input id="link-icon" bind:value={fontIcon} placeholder="图标地址，可留空" />
	</div>
	{#if fontIcon}
		<p><img class="size-7 object-contain" src={iconSrc(fontIcon)} alt="" /></p>
	{/if}
	<div class="flex flex-wrap items-end gap-3">
		<div class="grid min-w-52 flex-1 gap-1.5">
			<Label for="link-icon-file">上传图标</Label>
			<Input
				id="link-icon-file"
				type="file"
				accept=".ico,.jpg,.jpeg,.png,.bmp,.svg,image/*"
				disabled={saving}
				onchange={uploadIcon}
			/>
		</div>
		<Button type="button" variant="outline" disabled={saving} onclick={removeIcon}>删除图标</Button>
	</div>
	<div class="flex flex-wrap gap-2">
		<Button type="submit" disabled={saving}>{saving ? '保存中…' : editingId == null ? '添加' : '保存修改'}</Button>
		<Button type="button" variant="outline" disabled={saving} onclick={recognize}>识别</Button>
		{#if editingId != null}
			<Button type="button" variant="outline" disabled={saving} onclick={resetForm}>取消编辑</Button>
		{/if}
	</div>
</form>

<Card.Root size="sm" class="mb-6 max-w-3xl">
	<Card.Content class="grid gap-3">
		<div class="flex flex-wrap items-end gap-2">
			<div class="grid min-w-48 flex-1 gap-1.5">
				<Label>批量改分类</Label>
				<Select.Root type="single" value={batchFid} onValueChange={(value) => (batchFid = value)}>
					<Select.Trigger class="w-full">
						<Select.Value placeholder="选择分类" />
					</Select.Trigger>
					<Select.Content>
						{#each categories as item (num(item, 'id'))}
							<Select.Item value={String(num(item, 'id'))} label={str(item, 'name')}>{str(item, 'name')}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<Button type="button" variant="outline" disabled={saving} onclick={askBatch}>改到此分类</Button>
			<Button type="button" variant="outline" disabled={saving} onclick={() => batchProperty(1)}>设为私有</Button>
			<Button type="button" variant="outline" disabled={saving} onclick={() => batchProperty(0)}>设为公开</Button>
		</div>
		<p class="text-muted-foreground text-sm">已选 {selected.length} 条。</p>
	</Card.Content>
</Card.Root>

{#if loading}
	<p class="text-muted-foreground text-sm">正在加载链接…</p>
{:else if rows.length === 0}
	{#if !error}<p class="text-muted-foreground text-sm">还没有链接。</p>{/if}
{:else}
	<Table.Root class="min-w-[52rem]">
		<Table.Header>
			<Table.Row>
				<Table.Head class="w-10">
					<Checkbox
						checked={allOnPage}
						indeterminate={someOnPage && !allOnPage}
						onCheckedChange={(value) => togglePage(value)}
						aria-label="选择本页"
					/>
				</Table.Head>
				<Table.Head>标题</Table.Head>
				<Table.Head>URL</Table.Head>
				<Table.Head>备用 URL</Table.Head>
				<Table.Head>分类</Table.Head>
				<Table.Head>私有</Table.Head>
				<Table.Head>权重</Table.Head>
				<Table.Head>图标</Table.Head>
				<Table.Head>操作</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each rows as row (num(row, 'id'))}
				<Table.Row>
					<Table.Cell>
						<Checkbox
							checked={selected.includes(num(row, 'id'))}
							onCheckedChange={(value) => toggle(num(row, 'id'), value)}
							aria-label="选择 {str(row, 'title')}"
						/>
					</Table.Cell>
					<Table.Cell>
						{str(row, 'title')}
						{#if str(row, 'description')}<div class="text-muted-foreground">{str(row, 'description')}</div>{/if}
					</Table.Cell>
					<Table.Cell class="max-w-xs break-all">{str(row, 'url')}</Table.Cell>
					<Table.Cell class="max-w-xs break-all">{str(row, 'url_standby')}</Table.Cell>
					<Table.Cell>{str(row, 'category_name')}</Table.Cell>
					<Table.Cell>
						{#if num(row, 'property') === 1}
							<Badge variant="warning">是</Badge>
						{:else}
							否
						{/if}
					</Table.Cell>
					<Table.Cell>{num(row, 'weight')}</Table.Cell>
					<Table.Cell>
						{#if str(row, 'font_icon')}
							<img class="size-7 object-contain" src={iconSrc(str(row, 'font_icon'))} alt="" />
						{/if}
					</Table.Cell>
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
	title="删除链接"
	description={pendingDelete ? `确认删除链接「${str(pendingDelete, 'title')}」？` : ''}
	confirmLabel="删除"
	destructive
	pending={saving}
	onconfirm={confirmRemove}
/>

<ConfirmDialog
	bind:open={confirmBatch}
	title="修改分类"
	description={`确认将选中链接的分类修改为「${batchLabel ? str(batchLabel, 'name') : batchFid}」？`}
	confirmLabel="改到此分类"
	pending={saving}
	onconfirm={confirmBatchCategory}
/>
