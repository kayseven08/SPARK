<script context="module" lang="ts">
	let nextId = 0;
</script>

<script lang="ts">
	import { createEventDispatcher, onDestroy } from 'svelte';

	export let open = false;
	export let title: string;
	export let description = '';
	export let busy = false;
	export let wide = false;

	const dispatch = createEventDispatcher();
	const titleId = `modal-title-${++nextId}`;
	const descriptionId = `${titleId}-description`;
	let dialog: HTMLDialogElement;
	let opener: HTMLElement | null = null;
	onDestroy(() => {
		if (dialog?.open) dialog.close();
		if (opener?.isConnected) opener.focus({ preventScroll: true });
	});

	// The browser's top layer escapes transformed/blurred ancestors and keeps
	// nested editors above their parent while trapping focus in the top dialog.
	$: if (dialog) {
		if (open && !dialog.open) {
			opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			dialog.showModal();
		} else if (!open && dialog.open) dialog.close();
	}

	function close() {
		if (busy) return;
		open = false;
		dispatch('close');
	}

	function cancel(event: Event) {
		event.preventDefault();
		event.stopPropagation();
		close();
	}

	function backdrop(event: MouseEvent) {
		if (event.target !== dialog) return;
		const rect = dialog.getBoundingClientRect();
		if (
			event.clientX < rect.left ||
			event.clientX > rect.right ||
			event.clientY < rect.top ||
			event.clientY > rect.bottom
		)
			close();
	}
</script>

<dialog
	bind:this={dialog}
	class:wide
	aria-labelledby={titleId}
	aria-describedby={description ? descriptionId : undefined}
	aria-busy={busy}
	on:cancel={cancel}
	on:close={() => {
		open = false;
	}}
	on:click={backdrop}
>
	<div class="modal-shell">
		<header class="modal-header">
			<div class="modal-heading">
				<h2 id={titleId}>{title}</h2>
				{#if description}<p id={descriptionId}>{description}</p>{/if}
			</div>
			<button
				type="button"
				class="editor-icon-button"
				aria-label={`Close ${title}`}
				disabled={busy}
				on:click={close}
			>
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.7"
					aria-hidden="true"><path stroke-linecap="round" d="m6 6 12 12M6 18 18 6" /></svg
				>
			</button>
		</header>
		<div class="modal-body"><slot /></div>
		{#if $$slots.footer}<footer class="modal-footer"><slot name="footer" /></footer>{/if}
	</div>
</dialog>

<style>
	dialog {
		position: fixed;
		inset: 0;
		margin: auto;
		width: min(42rem, calc(100vw - 2rem));
		max-width: none;
		max-height: min(90vh, 54rem);
		max-height: min(90dvh, 54rem);
		padding: 0;
		color: #f4f4f5;
		background: #09090b;
		border: 1px solid rgb(255 255 255 / 0.12);
		border-radius: 1.25rem;
		box-shadow: 0 32px 100px rgb(0 0 0 / 0.6);
		overflow: hidden;
	}
	dialog.wide {
		width: min(68rem, calc(100vw - 2rem));
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.72);
		backdrop-filter: blur(5px);
	}
	.modal-shell {
		display: flex;
		flex-direction: column;
		max-height: inherit;
		min-width: 0;
	}
	.modal-header {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		padding: 1.5rem;
		border-bottom: 1px solid rgb(255 255 255 / 0.07);
		flex-shrink: 0;
	}
	.modal-heading {
		flex: 1;
		min-width: 0;
	}
	h2 {
		font-size: 1.2rem;
		font-weight: 650;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.modal-heading p {
		margin-top: 0.3rem;
		color: #a1a1aa;
		font-size: 0.875rem;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	.modal-body {
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 1.5rem;
		scrollbar-width: thin;
		scrollbar-color: #3f3f46 transparent;
	}
	.modal-footer {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 0.75rem;
		padding: 1rem 1.5rem;
		border-top: 1px solid rgb(255 255 255 / 0.07);
		background: #0e0e11;
	}
	@media (max-width: 600px) {
		dialog,
		dialog.wide {
			width: calc(100vw - 1rem);
			max-height: 94vh;
			max-height: 94dvh;
			border-radius: 1rem;
		}
		.modal-header,
		.modal-body {
			padding: 1rem;
		}
		.modal-footer {
			padding: 0.875rem 1rem;
		}
	}
</style>
