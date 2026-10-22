<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '#lib/components/ui/button';
	import * as Card from '#lib/components/ui/card';
	import { Input } from '#lib/components/ui/input';
	import { Label } from '#lib/components/ui/label';
	import * as RadioGroup from '#lib/components/ui/radio-group';
	import { Textarea } from '#lib/components/ui/textarea';
	import { apiGet, apiPost, errorText, isOk, objectData, str } from '#lib/components/admin/api';
	import ConfirmDialog from '#lib/components/admin/ConfirmDialog.svelte';

	let loading = $state(true);
	let ready = $state(false);
	let saving = $state(false);
	let error = $state('');
	let title = $state('');
	let logo = $state('');
	let subtitle = $state('');
	let keywords = $state('');
	let linkModel = $state('jump');
	let linkNum = $state('');
	let description = $state('');
	let customHeader = $state('');
	let customFooter = $state('');
	let secretKey = $state('');
	let confirmSecret = $state(false);

	onMount(() => {
		void load();
	});

	async function load() {
		loading = true;
		error = '';
		try {
			const body = await apiGet('site_info');
			if (!isOk(body.code)) throw new Error(errorText(body, '站点设置加载失败'));
			const site = objectData(body);
			title = str(site, 'title');
			logo = str(site, 'logo');
			subtitle = str(site, 'subtitle');
			keywords = str(site, 'keywords');
			linkModel = str(site, 'link_model') === 'direct' ? 'direct' : 'jump';
			linkNum = str(site, 'link_num');
			description = str(site, 'description');
			customHeader = str(site, 'custom_header');
			customFooter = str(site, 'custom_footer');
			ready = true;
		} catch (cause) {
			ready = false;
			error = cause instanceof Error ? cause.message : '站点设置加载失败';
		} finally {
			loading = false;
		}
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (!title.trim()) {
			error = '请填写网站标题';
			return;
		}
		saving = true;
		try {
			const body = await apiPost('set_site', {
				title,
				logo,
				subtitle,
				keywords,
				link_model: linkModel,
				link_num: linkNum,
				description,
				custom_header: customHeader,
				custom_footer: customFooter
			});
			if (!isOk(body.code)) throw new Error(errorText(body));
			toast.success(typeof body.data === 'string' && body.data ? body.data : '已保存');
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '保存失败';
		} finally {
			saving = false;
		}
	}

	function askSecret() {
		error = '';
		if (secretKey) {
			error = 'SecretKey 已经存在';
			return;
		}
		confirmSecret = true;
	}

	async function createSecret() {
		confirmSecret = false;
		saving = true;
		error = '';
		try {
			const body = await apiPost('create_sk', {});
			if (!isOk(body.code)) throw new Error(errorText(body));
			if (typeof body.data !== 'string' || !body.data) throw new Error('没有返回 SecretKey');
			secretKey = body.data;
			toast.success('SecretKey 生成完毕');
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '生成失败';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>站点设置</title>
</svelte:head>

<h1 class="text-xl font-semibold tracking-tight">站点设置</h1>
{#if loading}<p class="text-muted-foreground mt-3 text-sm">正在加载站点设置…</p>{/if}
{#if error}<p class="text-destructive mt-3 text-sm" role="alert">{error}</p>{/if}

<form class="mt-5 grid max-w-2xl gap-4" onsubmit={save}>
	<div class="grid gap-1.5">
		<Label for="site-title">网站标题</Label>
		<Input id="site-title" bind:value={title} required />
	</div>
	<div class="grid gap-1.5">
		<Label for="site-logo">网站 logo</Label>
		<Input id="site-logo" bind:value={logo} placeholder="相对路径或图片 URL，部分主题支持" />
	</div>
	<div class="grid gap-1.5">
		<Label for="site-subtitle">副标题</Label>
		<Input id="site-subtitle" bind:value={subtitle} />
	</div>
	<div class="grid gap-1.5">
		<Label for="site-keywords">网站关键词</Label>
		<Input id="site-keywords" bind:value={keywords} placeholder="用英文逗号分隔" />
	</div>
	<fieldset class="grid gap-2">
		<legend class="text-sm font-medium">直链模式</legend>
		<RadioGroup.Root bind:value={linkModel} class="flex flex-row flex-wrap gap-4">
			<Label class="font-normal"><RadioGroup.Item value="jump" />关闭</Label>
			<Label class="font-normal"><RadioGroup.Item value="direct" />开启</Label>
		</RadioGroup.Root>
		<p class="text-muted-foreground text-sm">开启后直接打开目标地址，不经过过渡页。仅部分主题支持。</p>
	</fieldset>
	<div class="grid gap-1.5">
		<Label for="site-link-num">链接数量</Label>
		<Input id="site-link-num" type="number" min="0" bind:value={linkNum} placeholder="首页单个分类展示的链接数，默认 30" />
	</div>
	<div class="grid gap-1.5">
		<Label for="site-desc">网站描述</Label>
		<Textarea id="site-desc" rows={4} bind:value={description}></Textarea>
	</div>
	<div class="grid gap-1.5">
		<Label for="site-header">自定义 header</Label>
		<Textarea id="site-header" rows={6} bind:value={customHeader} placeholder="可放统计代码或自定义 CSS"></Textarea>
	</div>
	<div class="grid gap-1.5">
		<Label for="site-footer">自定义 footer</Label>
		<Textarea id="site-footer" rows={4} bind:value={customFooter} placeholder="支持 HTML。PHP 里非空内容需要订阅。"></Textarea>
	</div>
	<Button type="submit" disabled={saving || loading || !ready}>{saving ? '保存中…' : '保存设置'}</Button>
</form>

<Card.Root size="sm" class="mt-6 max-w-2xl">
	<Card.Header>
		<Card.Title>SecretKey</Card.Title>
	</Card.Header>
	<Card.Content class="grid gap-3">
		<div class="grid gap-1.5">
			<Label for="secret-key">SecretKey</Label>
			<Input id="secret-key" readonly value={secretKey} placeholder="生成后显示在这里" />
		</div>
		<p class="text-muted-foreground text-sm">这里读不到已经保存在库里的 SecretKey。本次生成成功后，再点不会重复请求。</p>
		<Button type="button" variant="outline" disabled={saving} onclick={askSecret}>生成 SecretKey</Button>
	</Card.Content>
</Card.Root>

<ConfirmDialog
	bind:open={confirmSecret}
	title="生成 SecretKey"
	description="生成会写入一把新的 SecretKey。如果库里已经有，会被这把替换。确定生成？"
	confirmLabel="生成"
	pending={saving}
	onconfirm={createSecret}
/>
