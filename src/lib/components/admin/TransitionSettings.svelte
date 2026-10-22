<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import { Label } from '#lib/components/ui/label';
	import * as RadioGroup from '#lib/components/ui/radio-group';
	import { Textarea } from '#lib/components/ui/textarea';
	import { apiGet, apiPost, errorText, isOk, objectData, str } from '#lib/components/admin/api';

	let loading = $state(true);
	let ready = $state(false);
	let saving = $state(false);
	let error = $state('');
	let control = $state('off');
	let visitorStay = $state('');
	let adminStay = $state('');
	let ad1 = $state('');
	let ad2 = $state('');

	onMount(() => {
		void load();
	});

	async function load() {
		loading = true;
		error = '';
		try {
			const body = await apiGet('transition_page');
			if (!isOk(body.code)) throw new Error(errorText(body, '过渡页设置加载失败'));
			const page = objectData(body);
			control = str(page, 'control') === 'on' ? 'on' : 'off';
			visitorStay = str(page, 'visitor_stay_time');
			adminStay = str(page, 'admin_stay_time');
			ad1 = str(page, 'a_d_1');
			ad2 = str(page, 'a_d_2');
			ready = true;
		} catch (cause) {
			ready = false;
			error = cause instanceof Error ? cause.message : '过渡页设置加载失败';
		} finally {
			loading = false;
		}
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		saving = true;
		try {
			const body = await apiPost('set_transition_page', {
				control,
				visitor_stay_time: visitorStay === '' ? 0 : Number(visitorStay),
				admin_stay_time: adminStay === '' ? 0 : Number(adminStay),
				a_d_1: ad1,
				a_d_2: ad2
			});
			if (!isOk(body.code)) throw new Error(errorText(body));
			toast.success(typeof body.data === 'string' && body.data ? body.data : '已保存');
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '保存失败';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>过渡页</title>
</svelte:head>

<h1 class="text-xl font-semibold tracking-tight">过渡页</h1>
<p class="text-muted-foreground mt-2 text-sm">停留时间单位是秒。广告内容在 PHP 里需要订阅后才能保存非空值。</p>
{#if loading}<p class="text-muted-foreground mt-3 text-sm">正在加载过渡页…</p>{/if}
{#if error}<p class="text-destructive mt-3 text-sm" role="alert">{error}</p>{/if}

<form class="mt-5 grid max-w-2xl gap-4" onsubmit={save}>
	<fieldset class="grid gap-2">
		<legend class="text-sm font-medium">过渡页</legend>
		<RadioGroup.Root bind:value={control} class="flex flex-row flex-wrap gap-4">
			<Label class="font-normal"><RadioGroup.Item value="off" />关闭</Label>
			<Label class="font-normal"><RadioGroup.Item value="on" />开启</Label>
		</RadioGroup.Root>
	</fieldset>
	<div class="grid gap-1.5">
		<Label for="visitor-stay">访客停留时间</Label>
		<Input id="visitor-stay" type="number" min="0" max="86400" bind:value={visitorStay} />
	</div>
	<div class="grid gap-1.5">
		<Label for="admin-stay">管理员停留时间</Label>
		<Input id="admin-stay" type="number" min="0" max="86400" bind:value={adminStay} />
	</div>
	<div class="grid gap-1.5">
		<Label for="ad-1">广告 1</Label>
		<Textarea id="ad-1" rows={3} bind:value={ad1}></Textarea>
	</div>
	<div class="grid gap-1.5">
		<Label for="ad-2">广告 2</Label>
		<Textarea id="ad-2" rows={3} bind:value={ad2}></Textarea>
	</div>
	<Button type="submit" disabled={saving || loading || !ready}>{saving ? '保存中…' : '保存设置'}</Button>
</form>
