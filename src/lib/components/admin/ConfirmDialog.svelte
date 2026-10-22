<script lang="ts">
	import { Button } from '#lib/components/ui/button';
	import * as Dialog from '#lib/components/ui/dialog';

	let {
		open = $bindable(false),
		title,
		description,
		confirmLabel = '确定',
		destructive = false,
		pending = false,
		onconfirm,
		onOpenChange
	}: {
		open?: boolean;
		title: string;
		description: string;
		confirmLabel?: string;
		destructive?: boolean;
		pending?: boolean;
		onconfirm: () => void;
		onOpenChange?: (open: boolean) => void;
	} = $props();
</script>

<Dialog.Root
	{open}
	onOpenChange={(next) => {
		open = next;
		onOpenChange?.(next);
	}}
>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" type="button" disabled={pending} onclick={() => (open = false)}>取消</Button>
			<Button variant={destructive ? 'destructive' : 'default'} type="button" disabled={pending} onclick={onconfirm}>
				{confirmLabel}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
