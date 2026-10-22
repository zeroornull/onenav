<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ConfirmDialog from '#lib/components/admin/ConfirmDialog.svelte';
	import { Button } from '#lib/components/ui/button';
	import * as Card from '#lib/components/ui/card';
	import { Checkbox } from '#lib/components/ui/checkbox';
	import { Input } from '#lib/components/ui/input';
	import { Label } from '#lib/components/ui/label';
	import * as Table from '#lib/components/ui/table';
	import {
		apiGet,
		apiPost,
		apiUpload,
		downloadApi,
		errorText,
		fileNameOf,
		isOk,
		listData,
		str,
		type ApiBody,
		type Row
	} from '#lib/components/admin/api';

	let backups = $state<Row[]>([]);
	let loading = $state(true);
	let saving = $state(false);
	let error = $state('');
	let bookmarkName = $state('');
	let bookmarkPrivate = $state(false);
	let importSummary = $state('');
	let pendingBackup = $state('');
	let restoreName = $state('');
	let restoreStep = $state(0);

	onMount(() => {
		void loadBackups();
	});

	async function loadBackups() {
		loading = true;
		error = '';
		try {
			const body = await apiGet('backup_db_list');
			if (!isOk(body.code)) throw new Error(errorText(body, '备份列表加载失败'));
			backups = listData(body);
		} catch (cause) {
			backups = [];
			error = cause instanceof Error ? cause.message : '备份列表加载失败';
		} finally {
			loading = false;
		}
	}

	function stamp(): string {
		const date = new Date();
		const pad = (part: number) => String(part).padStart(2, '0');
		return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
	}

	async function run(task: () => Promise<void>) {
		saving = true;
		error = '';
		try {
			await task();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '操作失败';
		} finally {
			saving = false;
		}
	}

	function exportHtml() {
		void run(() => downloadApi('export_link', `OneNav_Export_${stamp()}.html`));
	}

	function exportJson() {
		void run(() => downloadApi('export_json', `OneNav_Export_${stamp()}.json`));
	}

	async function uploadBookmark(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		await run(async () => {
			const body = await apiUpload('upload', file);
			if (!isOk(body.code)) throw new Error(errorText(body, '上传失败'));
			const name = fileNameOf(body);
			if (!name) throw new Error('上传成功但没有返回书签路径');
			bookmarkName = name;
			toast.success('书签文件已上传。需要再点「开始导入」才会写入链接。');
		});
	}

	function importLinks() {
		if (!bookmarkName.trim()) {
			error = '请先上传书签，或填写书签路径';
			return;
		}
		void run(async () => {
			const body = await apiPost('import_link', {
				filename: bookmarkName,
				property: bookmarkPrivate ? 1 : 0
			});
			if (!isOk(body.code)) throw new Error(errorText(body, '导入失败'));
			importSummary = summarizeImport(body);
			toast.success('导入完成');
		});
	}

	function summarizeImport(body: ApiBody): string {
		const msg = body.msg;
		if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
			const record = msg as Row;
			return `总数 ${str(record, 'count') || '0'}，成功 ${str(record, 'success') || '0'}，失败 ${str(record, 'failed') || '0'}`;
		}
		if (typeof body.data === 'string' && body.data) return body.data;
		return '导入接口已返回成功';
	}

	function backupNow() {
		void run(async () => {
			const body = await apiGet('backup_db');
			if (!isOk(body.code)) throw new Error(errorText(body, '备份失败'));
			toast.success('备份成功');
			await loadBackups();
		});
	}

	async function uploadBackup(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!/^onenav_[0-9]{12}_[0-9]{1,2}\.[0-9]{1,2}\.[0-9]{1,2}\.db3$/.test(file.name)) {
			error = '文件名需类似 onenav_202312071528_0.9.32.db3';
			return;
		}
		await run(async () => {
			const body = await apiUpload('upload_backup', file);
			if (!isOk(body.code)) throw new Error(errorText(body, '上传备份失败'));
			toast.success('备份已上传');
			await loadBackups();
		});
	}

	function downloadBackup(name: string) {
		void run(() => downloadApi(`down_db?name=${encodeURIComponent(name)}`, name));
	}

	async function confirmRemoveBackup() {
		const name = pendingBackup;
		pendingBackup = '';
		if (!name) return;
		await run(async () => {
			const body = await apiGet('del_backup_db', { name });
			if (!isOk(body.code)) throw new Error(errorText(body, '删除失败'));
			toast.success('备份已删除');
			await loadBackups();
		});
	}

	function confirmRestore() {
		if (restoreStep === 1) {
			restoreStep = 2;
			return;
		}
		const name = restoreName;
		restoreStep = 0;
		void run(async () => {
			const body = await apiGet('restore_db', { name });
			if (!isOk(body.code)) throw new Error(errorText(body, '恢复失败'));
			toast.success(typeof body.msg === 'string' && body.msg ? body.msg : '已恢复');
			await loadBackups();
		});
	}
</script>

<svelte:head>
	<title>导入导出</title>
</svelte:head>

<h1 class="text-xl font-semibold tracking-tight">导入导出</h1>
<Card.Root size="sm" class="mt-4 max-w-2xl">
	<Card.Content class="grid gap-2 text-sm">
		<p>恢复会用所选备份覆盖当前数据库，当前库里的分类、链接和设置都会被替换。</p>
		<p>恢复按钮要点两次确认才会请求接口。打开本页不会自动导入，也不会自动恢复。</p>
	</Card.Content>
</Card.Root>

{#if error}<p class="text-destructive mt-4 text-sm" role="alert">{error}</p>{/if}
{#if importSummary}<p class="mt-4 text-sm">{importSummary}</p>{/if}

<Card.Root size="sm" class="mt-4 max-w-2xl">
	<Card.Header>
		<Card.Title>导出</Card.Title>
	</Card.Header>
	<Card.Content>
		<div class="flex flex-wrap gap-2">
			<Button type="button" variant="outline" disabled={saving} onclick={exportHtml}>下载 HTML 导出</Button>
			<Button type="button" variant="outline" disabled={saving} onclick={exportJson}>下载 JSON 导出</Button>
		</div>
	</Card.Content>
</Card.Root>

<Card.Root size="sm" class="mt-4 max-w-2xl">
	<Card.Header>
		<Card.Title>导入书签</Card.Title>
	</Card.Header>
	<Card.Content class="grid gap-4">
		<p class="text-muted-foreground text-sm">仅支持 .html。上传后得到路径，再点开始导入。导入会按文件创建缺少的分类，并跳过重复链接。</p>
		<div class="grid gap-1.5">
			<Label for="bookmark-file">上传书签</Label>
			<Input id="bookmark-file" type="file" accept=".html,text/html" disabled={saving} onchange={uploadBookmark} />
		</div>
		<div class="grid gap-1.5">
			<Label for="bookmark-path">书签路径</Label>
			<Input id="bookmark-path" bind:value={bookmarkName} placeholder="上传成功后填入，也可手工填写" />
		</div>
		<Label class="font-normal">
			<Checkbox bind:checked={bookmarkPrivate} />
			导入为私有
		</Label>
		<Button type="button" disabled={saving} onclick={importLinks}>{saving ? '处理中…' : '开始导入'}</Button>
	</Card.Content>
</Card.Root>

<Card.Root size="sm" class="mt-4 max-w-2xl">
	<Card.Header>
		<Card.Title>备份</Card.Title>
	</Card.Header>
	<Card.Content class="grid gap-4">
		<p class="text-muted-foreground text-sm">备份文件名需符合 onenav_年月时分_版本.db3。列表只保留最近的备份。</p>
		<div class="flex flex-wrap items-end gap-3">
			<Button type="button" disabled={saving} onclick={backupNow}>{saving ? '处理中…' : '立即备份'}</Button>
			<div class="grid min-w-52 flex-1 gap-1.5">
				<Label for="backup-file">上传备份</Label>
				<Input id="backup-file" type="file" accept=".db3" disabled={saving} onchange={uploadBackup} />
			</div>
		</div>
	</Card.Content>
</Card.Root>

{#if loading}
	<p class="text-muted-foreground mt-4 text-sm">正在加载备份…</p>
{:else if backups.length === 0}
	{#if !error}<p class="text-muted-foreground mt-4 text-sm">还没有备份。</p>{/if}
{:else}
	<div class="mt-4">
		<Table.Root class="min-w-[44rem]">
			<Table.Header>
				<Table.Row>
					<Table.Head>文件名</Table.Head>
					<Table.Head>备份时间</Table.Head>
					<Table.Head>大小</Table.Head>
					<Table.Head>操作</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each backups as row, index (`${str(row, 'name')}-${index}`)}
					<Table.Row>
						<Table.Cell>{str(row, 'name')}</Table.Cell>
						<Table.Cell>{str(row, 'mtime')}</Table.Cell>
						<Table.Cell>{str(row, 'size')}</Table.Cell>
						<Table.Cell>
							<div class="flex flex-wrap gap-2">
								<Button
									type="button"
									variant="destructive"
									size="sm"
									disabled={saving}
									onclick={() => {
										restoreName = str(row, 'name');
										restoreStep = 1;
									}}
								>
									恢复
								</Button>
								<Button type="button" variant="outline" size="sm" disabled={saving} onclick={() => downloadBackup(str(row, 'name'))}>
									下载
								</Button>
								<Button type="button" variant="outline" size="sm" disabled={saving} onclick={() => (pendingBackup = str(row, 'name'))}>
									删除
								</Button>
							</div>
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
{/if}

<ConfirmDialog
	open={pendingBackup !== ''}
	onOpenChange={(next) => {
		if (!next) pendingBackup = '';
	}}
	title="删除备份"
	description={pendingBackup ? `确认删除备份 ${pendingBackup}？` : ''}
	confirmLabel="删除"
	destructive
	pending={saving}
	onconfirm={confirmRemoveBackup}
/>

<ConfirmDialog
	open={restoreStep > 0}
	onOpenChange={(next) => {
		if (!next) restoreStep = 0;
	}}
	title={restoreStep === 2 ? '再次确认恢复' : '确认恢复'}
	description={restoreStep === 2
		? `第二次确认：当前库会被「${restoreName}」整个替换，此页不能撤销。确定恢复？`
		: `第一次确认：恢复「${restoreName}」会覆盖当前数据库。`}
	confirmLabel={restoreStep === 2 ? '确定恢复' : '继续'}
	destructive
	pending={saving}
	onconfirm={confirmRestore}
/>
