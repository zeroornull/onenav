<script lang="ts">
	import { Badge } from '#lib/components/ui/badge';
	import type { HomeLink } from '#lib/components/home/types';

	let {
		link,
		showPrivate,
		editable = false,
		reorderable = false,
		dragging = false,
		dropTarget = false,
		oncontext,
		ondragstart,
		ondragover,
		ondrop,
		ondragend
	}: {
		link: HomeLink;
		showPrivate: boolean;
		editable?: boolean;
		reorderable?: boolean;
		dragging?: boolean;
		dropTarget?: boolean;
		oncontext?: (event: MouseEvent) => void;
		ondragstart?: () => void;
		ondragover?: (event: DragEvent) => void;
		ondrop?: (event: DragEvent) => void;
		ondragend?: () => void;
	} = $props();

	let suppressClick = false;

	const iconText = $derived(link.title.trim() || '空');

	function startDrag(event: DragEvent) {
		if (!reorderable) {
			event.preventDefault();
			return;
		}
		suppressClick = true;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', String(link.id));
		}
		ondragstart?.();
	}

	function endDrag() {
		ondragend?.();
		setTimeout(() => {
			suppressClick = false;
		}, 50);
	}

	function follow(event: MouseEvent) {
		if (!suppressClick) return;
		event.preventDefault();
		suppressClick = false;
	}
</script>

<a
	class="group bg-card text-card-foreground flex h-full rounded-xl no-underline shadow-sm outline-none transition-[transform,box-shadow,background-color] duration-200 ease-out motion-reduce:transition-none motion-reduce:hover:transform-none hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring active:translate-y-0 dark:shadow-none dark:ring-1 dark:ring-foreground/15 dark:hover:shadow-none {dropTarget
		? 'bg-accent -translate-y-0.5 shadow-md'
		: ''} {reorderable ? 'cursor-grab active:cursor-grabbing' : ''} {dragging ? 'opacity-40' : ''}"
	href="/click/{link.id}"
	draggable={reorderable}
	ondragstart={startDrag}
	ondragend={endDrag}
	ondragover={(event) => {
		if (!reorderable) return;
		ondragover?.(event);
	}}
	ondrop={(event) => {
		if (!reorderable) return;
		event.preventDefault();
		ondrop?.(event);
	}}
	onclick={follow}
	oncontextmenu={(event) => {
		if (!editable) return;
		event.preventDefault();
		oncontext?.(event);
	}}
>
	<span class="flex min-w-0 items-start gap-3 px-3 py-3">
		<span class="bg-secondary group-hover:bg-accent flex size-11 shrink-0 items-center justify-center rounded-lg transition-colors duration-200 ease-out motion-reduce:transition-none">
			<img
				src="/ico?text={encodeURIComponent(iconText)}"
				alt=""
				width="24"
				height="24"
				draggable="false"
				class="size-6"
			/>
		</span>
		<span class="grid min-w-0 gap-0.5">
			<span class="flex flex-wrap items-center gap-1.5 font-semibold">
				{link.title}
				{#if showPrivate && link.property === 1}
					<Badge variant="warning">私有</Badge>
				{/if}
			</span>
			{#if link.description}
				<span class="text-muted-foreground truncate text-sm">{link.description}</span>
			{/if}
			<span class="text-muted-foreground truncate text-sm">{link.url}</span>
		</span>
	</span>
</a>
