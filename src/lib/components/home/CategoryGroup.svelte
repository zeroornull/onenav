<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { Badge } from '#lib/components/ui/badge';
	import { Button } from '#lib/components/ui/button';
	import { Checkbox } from '#lib/components/ui/checkbox';
	import * as Dialog from '#lib/components/ui/dialog';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu';
	import { Input } from '#lib/components/ui/input';
	import { Label } from '#lib/components/ui/label';
	import { Textarea } from '#lib/components/ui/textarea';
	import LinkCard from '#lib/components/home/LinkCard.svelte';
	import { orderPayload, type RankedId } from '#lib/components/home/reorder';
	import type { HomeLink } from '#lib/components/home/types';

	let {
		category,
		links,
		showPrivate,
		editable = false,
		reorderable = false
	}: {
		category: {
			id: number;
			name: string;
			description: string;
			fid: number;
			property: number;
		};
		links: HomeLink[];
		showPrivate: boolean;
		editable?: boolean;
		reorderable?: boolean;
	} = $props();

	const URL_PATTERN =
		/^(http:\/\/|https:\/\/|ftp:\/\/|ftps:\/\/|magnet:?|ed2k:\/\/|tcp:\/\/|udp:\/\/|thunder:\/\/|rtsp:\/\/|rtmp:\/\/|sftp:\/\/).+/;

	let override = $state<HomeLink[] | null>(null);
	let dragId = $state<number | null>(null);
	let dropTarget = $state<number | null>(null);
	let busy = $state(false);
	let menuOpen = $state(false);
	let menuX = $state(0);
	let menuY = $state(0);
	let active = $state<HomeLink | null>(null);
	let editOpen = $state(false);
	let deleteOpen = $state(false);
	let title = $state('');
	let url = $state('');
	let standby = $state('');
	let description = $state('');
	let isPrivate = $state(false);

	const order = $derived(override ?? links);

	function currentLink(): HomeLink | null {
		if (!active) return null;
		return order.find((item) => item.id === active?.id) ?? active;
	}

	function openMenu(link: HomeLink, event: MouseEvent) {
		if (!editable) return;
		event.preventDefault();
		active = { ...link };
		menuX = event.clientX;
		menuY = event.clientY;
		menuOpen = false;
		requestAnimationFrame(() => {
			menuOpen = true;
		});
	}

	function startDrag(id: number) {
		if (!reorderable || busy) return;
		dragId = id;
	}

	function dragOver(id: number, event: DragEvent) {
		if (!reorderable || busy || dragId == null) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		dropTarget = id === dragId ? null : id;
	}

	function endDrag() {
		dragId = null;
		dropTarget = null;
	}

	function applyOrder(previous: HomeLink[], payload: RankedId[]): HomeLink[] {
		const byId = new Map(previous.map((link) => [link.id, link]));
		return payload.map((entry) => {
			const link = byId.get(entry.id);
			if (!link) throw new Error('排序数据不完整');
			return { ...link, weight: entry.weight };
		});
	}

	async function dropOn(id: number, event: DragEvent) {
		event.preventDefault();
		const fromId = dragId;
		dragId = null;
		dropTarget = null;
		if (!reorderable || busy || fromId == null || fromId === id) return;
		const previous = order.map((link) => ({ ...link }));
		const from = previous.findIndex((link) => link.id === fromId);
		const to = previous.findIndex((link) => link.id === id);
		if (from < 0 || to < 0 || from === to) return;
		let payload: RankedId[];
		try {
			payload = orderPayload(previous, from, to);
			override = applyOrder(previous, payload);
		} catch (error) {
			override = previous;
			toast.error(error instanceof Error ? error.message : '排序保存失败');
			return;
		}
		busy = true;
		try {
			const body = await postJson(
				`update_link_order?${new URLSearchParams({ category_id: String(category.id) })}`,
				payload
			);
			if (!isOk(body)) throw new Error(failureText(body, '排序保存失败'));
		} catch (error) {
			override = previous;
			toast.error(error instanceof Error ? error.message : '排序保存失败');
			return;
		} finally {
			busy = false;
		}
		toast.success('排序已保存');
		await refreshAfterSave();
	}

	function openEdit() {
		const link = currentLink();
		if (!link) return;
		title = link.title;
		url = link.url;
		standby = link.url_standby ?? '';
		description = link.description ?? '';
		isPrivate = link.property === 1;
		window.setTimeout(() => {
			editOpen = true;
		}, 0);
	}

	function openDelete() {
		if (!currentLink()) return;
		window.setTimeout(() => {
			deleteOpen = true;
		}, 0);
	}

	async function recognize() {
		const target = url.trim();
		if (!target) {
			toast.error('请先填写 URL');
			return;
		}
		busy = true;
		try {
			const body = await postJson('get_link_info', { url: target });
			if (!isOk(body)) throw new Error(failureText(body, '识别失败'));
			const data = body.data;
			if (!data || typeof data !== 'object' || Array.isArray(data)) {
				toast.error('没有识别到标题或描述');
				return;
			}
			const record = data as Record<string, unknown>;
			const nextTitle = typeof record.title === 'string' ? record.title.trim() : '';
			const nextDescription = typeof record.description === 'string' ? record.description.trim() : '';
			if (nextTitle) title = nextTitle;
			if (nextDescription) description = nextDescription;
			if (!nextTitle && !nextDescription) {
				toast.error('没有识别到标题或描述');
				return;
			}
			toast.success('已填入识别到的标题和描述');
		} catch (error) {
			toast.error(error instanceof Error ? error.message : '识别失败');
		} finally {
			busy = false;
		}
	}

	async function saveEdit(event: SubmitEvent) {
		event.preventDefault();
		const link = currentLink();
		if (!link) return;
		const nextTitle = title.trim();
		const nextUrl = url.trim();
		const nextStandby = standby.trim();
		if (!nextTitle) {
			toast.error('标题不能为空');
			return;
		}
		if (!nextUrl) {
			toast.error('URL 不能为空');
			return;
		}
		if (!URL_PATTERN.test(nextUrl) || (nextStandby && !URL_PATTERN.test(nextStandby))) {
			toast.error('URL 无效');
			return;
		}
		busy = true;
		try {
			const body = await postJson('edit_link', {
				id: link.id,
				fid: category.id,
				title: nextTitle,
				url: nextUrl,
				url_standby: nextStandby,
				description: description.trim(),
				property: isPrivate ? 1 : 0,
				weight: link.weight
			});
			if (!isOk(body)) throw new Error(failureText(body, '保存失败'));
		} catch (error) {
			toast.error(error instanceof Error ? error.message : '保存失败');
			return;
		} finally {
			busy = false;
		}
		override = order.map((item) =>
			item.id === link.id
				? {
						...item,
						title: nextTitle,
						url: nextUrl,
						url_standby: nextStandby || null,
						description: description.trim() || null,
						property: isPrivate ? 1 : 0
					}
				: item
		);
		toast.success('已更新');
		editOpen = false;
		await refreshAfterSave();
	}

	async function confirmDelete() {
		const link = currentLink();
		if (!link) return;
		const previous = order.map((item) => ({ ...item }));
		override = previous.filter((item) => item.id !== link.id);
		busy = true;
		try {
			const body = await postJson('del_link', { id: link.id });
			if (!isOk(body)) throw new Error(failureText(body, '删除失败'));
		} catch (error) {
			override = previous;
			toast.error(error instanceof Error ? error.message : '删除失败');
			return;
		} finally {
			busy = false;
		}
		toast.success('已删除');
		deleteOpen = false;
		active = null;
		await refreshAfterSave();
	}

	async function togglePrivate() {
		const link = currentLink();
		if (!link || busy) return;
		const next = link.property === 1 ? 0 : 1;
		const previous = order.map((item) => ({ ...item }));
		override = previous.map((item) => (item.id === link.id ? { ...item, property: next } : item));
		active = { ...link, property: next };
		busy = true;
		try {
			const body = await postJson('set_link_attribute', { ids: link.id, property: next });
			if (!isOk(body)) throw new Error(failureText(body, '切换私有失败'));
		} catch (error) {
			override = previous;
			active = { ...link, property: link.property };
			toast.error(error instanceof Error ? error.message : '切换私有失败');
			return;
		} finally {
			busy = false;
		}
		toast.success(next === 1 ? '已设为私有' : '已设为公开');
		await refreshAfterSave();
	}

	async function refreshAfterSave() {
		try {
			await invalidateAll();
			override = null;
		} catch {
			toast.error('已保存，但页面刷新失败');
		}
	}

	function isOk(body: Record<string, unknown>): boolean {
		return body.code === 0 || body.code === 200;
	}

	function failureText(body: Record<string, unknown>, fallback: string): string {
		const raw =
			typeof body.err_msg === 'string' && body.err_msg
				? body.err_msg
				: typeof body.msg === 'string' && body.msg
					? body.msg
					: '';
		const known: Record<string, string> = {
			'Authorization failure!': '没有权限，请重新登录',
			'The title cannot be empty!': '标题不能为空',
			'URL cannot be empty!': 'URL 不能为空',
			'URL is not valid!': 'URL 无效',
			'link id not exists!': '链接不存在',
			'The URL already exists!': '这个 URL 已经存在',
			'The category id(fid) not exist!': '分类不存在',
			'The category not exist!': '分类不存在',
			failed: '操作失败',
			'URL不能为空!': 'URL 不能为空'
		};
		if (!raw || raw === 'success' || raw === 'successful') return fallback;
		if (known[raw]) return known[raw];
		if (/[\u4e00-\u9fff]/.test(raw)) return raw;
		return fallback;
	}

	async function postJson(path: string, payload: unknown): Promise<Record<string, unknown>> {
		let response: Response;
		try {
			response = await fetch(`/api/${path}`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload)
			});
		} catch {
			throw new Error('网络异常，请稍后再试');
		}
		const text = await response.text();
		if (!text.trim()) throw new Error('接口没有返回内容');
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			throw new Error('接口返回的不是 JSON');
		}
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('code' in parsed)) {
			throw new Error('接口响应无效');
		}
		return parsed as Record<string, unknown>;
	}
</script>

<section id="cat-{category.id}" class="{category.fid !== 0 ? 'mt-8' : 'mt-10'}">
	<header class="mb-3">
		<h2 class="flex flex-wrap items-center gap-2 text-lg font-semibold">
			{category.name}
			{#if showPrivate && category.property === 1}
				<Badge variant="warning">私有</Badge>
			{/if}
			{#if category.fid !== 0}
				<Badge variant="outline">子分类</Badge>
			{/if}
		</h2>
		{#if category.description}
			<p class="text-muted-foreground mt-1 text-sm">{category.description}</p>
		{/if}
	</header>
	{#if order.length === 0}
		<p class="text-muted-foreground text-sm">此分类下没有链接。</p>
	{:else}
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{#each order as link (link.id)}
				<LinkCard
					{link}
					{showPrivate}
					{editable}
					reorderable={reorderable && !busy}
					dragging={dragId === link.id}
					dropTarget={dropTarget === link.id}
					oncontext={(event) => openMenu(link, event)}
					ondragstart={() => startDrag(link.id)}
					ondragover={(event) => dragOver(link.id, event)}
					ondrop={(event) => dropOn(link.id, event)}
					ondragend={endDrag}
				/>
			{/each}
		</div>
	{/if}

	{#if editable}
		<DropdownMenu.Root bind:open={menuOpen}>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						type="button"
						class="pointer-events-none fixed z-50 size-px p-0 opacity-0"
						style:left="{menuX}px"
						style:top="{menuY}px"
						tabindex="-1"
						aria-hidden="true"
					></button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content class="w-40" align="start">
				<DropdownMenu.Item disabled={busy} onSelect={openEdit}>编辑</DropdownMenu.Item>
				<DropdownMenu.Item disabled={busy} onSelect={togglePrivate}>切换私有</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<DropdownMenu.Item variant="destructive" disabled={busy} onSelect={openDelete}>删除</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>

		<Dialog.Root bind:open={editOpen}>
			<Dialog.Content class="sm:max-w-md">
				<Dialog.Header>
					<Dialog.Title>编辑链接</Dialog.Title>
					<Dialog.Description>修改标题、URL、描述、私有或备用链接。</Dialog.Description>
				</Dialog.Header>
				<form class="grid gap-4" onsubmit={saveEdit}>
					<div class="grid gap-1.5">
						<Label for="home-link-title-{category.id}">标题</Label>
						<Input id="home-link-title-{category.id}" bind:value={title} disabled={busy} autocomplete="off" />
					</div>
					<div class="grid gap-1.5">
						<Label for="home-link-url-{category.id}">URL</Label>
						<div class="flex gap-2">
							<Input id="home-link-url-{category.id}" bind:value={url} disabled={busy} autocomplete="off" />
							<Button type="button" variant="outline" disabled={busy} onclick={recognize}>识别</Button>
						</div>
					</div>
					<div class="grid gap-1.5">
						<Label for="home-link-standby-{category.id}">备用链接</Label>
						<Input
							id="home-link-standby-{category.id}"
							bind:value={standby}
							disabled={busy}
							placeholder="没有可留空"
							autocomplete="off"
						/>
					</div>
					<div class="grid gap-1.5">
						<Label for="home-link-description-{category.id}">描述</Label>
						<Textarea id="home-link-description-{category.id}" rows={3} bind:value={description} disabled={busy}></Textarea>
					</div>
					<Label class="font-normal">
						<Checkbox bind:checked={isPrivate} disabled={busy} />
						私有
					</Label>
					<Dialog.Footer>
						<Button type="button" variant="outline" disabled={busy} onclick={() => (editOpen = false)}>取消</Button>
						<Button type="submit" disabled={busy}>保存</Button>
					</Dialog.Footer>
				</form>
			</Dialog.Content>
		</Dialog.Root>

		<Dialog.Root bind:open={deleteOpen}>
			<Dialog.Content>
				<Dialog.Header>
					<Dialog.Title>删除链接</Dialog.Title>
					<Dialog.Description>确定删除「{active?.title || '这条链接'}」？删除后不能恢复。</Dialog.Description>
				</Dialog.Header>
				<Dialog.Footer>
					<Button type="button" variant="outline" disabled={busy} onclick={() => (deleteOpen = false)}>取消</Button>
					<Button type="button" variant="destructive" disabled={busy} onclick={confirmDelete}>删除</Button>
				</Dialog.Footer>
			</Dialog.Content>
		</Dialog.Root>
	{/if}
</section>
