<script lang="ts">
	import { Toaster } from '#lib/components/ui/sonner';
	import '../app.css';

	let { children } = $props();
</script>

<Toaster theme="light" position="top-center" />
{@render children()}
