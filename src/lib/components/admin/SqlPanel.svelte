<script lang="ts">
	import { toast } from 'svelte-sonner';
	import ConfirmDialog from '#lib/components/admin/ConfirmDialog.svelte';
	import { apiPost, errorText, isOk, type Row } from '#lib/components/admin/api';
	import { Button } from '#lib/components/ui/button';
	import * as Card from '#lib/components/ui/card';
	import { Label } from '#lib/components/ui/label';
	import * as Table from '#lib/components/ui/table';
	import { Textarea } from '#lib/components/ui/textarea';

	const rowLimit = 200;

	let saving = $state(false);
	let error = $state('');
	let sql = $state('');
	let ran = $state(false);
	let resultRows = $state<Row[]>([]);
	let resultNote = $state('');
	let confirmRun = $state(false);

	const shownRows = $derived(resultRows.slice(0, rowLimit));
	const columns = $derived(columnNames(shownRows));

	function columnNames(rows: Row[]): string[] {
		const keys: string[] = [];
		for (const row of rows) {
			for (const key of Object.keys(row)) {
				if (!keys.includes(key)) keys.push(key);
			}
		}
		return keys;
	}

	function cellText(value: unknown): string {
		if (value == null) return '';
		if (typeof value === 'object') return JSON.stringify(value);
		return String(value);
	}

	function preview(): string {
		const text = sql.trim().replace(/\s+/g, ' ');
		if (text.length <= 160) return text;
		return `${text.slice(0, 160)}…`;
	}

	function askRun() {
		error = '';
		if (!sql.trim()) {
			error = '请先填写 SQL';
			return;
		}
		confirmRun = true;
	}

	async function runSql() {
		if (saving) return;
		const statement = sql.trim();
		confirmRun = false;
		if (!statement) {
			error = '请先填写 SQL';
			return;
		}
		saving = true;
		error = '';
		try {
			const body = await apiPost('exe_sql', { sql: statement });
			if (!isOk(body.code)) throw new Error(errorText(body, 'SQL 执行失败'));
			ran = true;
			if (Array.isArray(body.data)) {
				resultRows = body.data.filter(isRow);
				resultNote = resultRows.length === 0 ? '查询没有返回行。' : '';
			} else {
				resultRows = [];
				resultNote = typeof body.data === 'string' && body.data ? body.data : '执行完成';
			}
			toast.success(resultRows.length > 0 ? `已返回 ${resultRows.length} 行` : resultNote || '执行完成');
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'SQL 执行失败';
		} finally {
			saving = false;
		}
	}

	function isRow(value: unknown): value is Row {
		return !!value && typeof value === 'object' && !Array.isArray(value);
	}
</script>

<svelte:head>
	<title>任意 SQL</title>
</svelte:head>

<h1 class="text-xl font-semibold tracking-tight">任意 SQL</h1>
<Card.Root size="sm" class="mt-4 max-w-3xl">
	<Card.Content class="grid gap-2 text-sm">
		<p>打开本页不会执行 SQL。执行前会再确认一次。</p>
		<p>确认后，语句会直接作用在当前数据库上，可能修改或删除数据。</p>
	</Card.Content>
</Card.Root>

{#if error}<p class="text-destructive mt-4 text-sm" role="alert">{error}</p>{/if}

<div class="mt-4 grid max-w-3xl gap-3">
	<div class="grid gap-1.5">
		<Label for="sql-text">SQL</Label>
		<Textarea id="sql-text" rows={10} class="font-mono" spellcheck="false" bind:value={sql}></Textarea>
	</div>
	<Button type="button" variant="destructive" disabled={saving} onclick={askRun}>
		{saving ? '执行中…' : '执行'}
	</Button>
</div>

{#if !ran}
	<p class="text-muted-foreground mt-4 text-sm">还没有执行。</p>
{:else if shownRows.length > 0 && columns.length > 0}
	<p class="text-muted-foreground mt-4 text-sm">
		共 {resultRows.length} 行{#if resultRows.length > shownRows.length}，这里显示前 {shownRows.length} 行{/if}。
	</p>
	<div class="mt-3 max-h-[32rem] overflow-auto">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					{#each columns as column (column)}
						<Table.Head>{column}</Table.Head>
					{/each}
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each shownRows as row, index (index)}
					<Table.Row>
						{#each columns as column (column)}
							{@const text = cellText(row[column])}
							<Table.Cell class="max-w-xs truncate" title={text}>{text}</Table.Cell>
						{/each}
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
{:else}
	<p class="mt-4 text-sm">{resultNote || '没有可显示的结果。'}</p>
{/if}

<ConfirmDialog
	bind:open={confirmRun}
	title="确认执行 SQL"
	description={`确认后会执行这段 SQL，可能修改或删除数据：${preview()}。取消则不会执行。`}
	confirmLabel="执行"
	destructive
	pending={saving}
	onconfirm={runSql}
/>
