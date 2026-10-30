<script lang="ts">
	import CommandPopup from './CommandPopup.svelte';
	import type { Command, Device } from '$lib';

	export let command: Command;
	export let device: Device = {};
	export let updateCommands: (updated: Command) => Promise<void>;
	export let deleteCommand: (command: Command) => Promise<void>;
	export let runCommand: (command: Command) => Promise<void>;
	export let allowTestRun = true;
	export let canRun = true;

	let popup = false;
	let pending = false;
	let errorMessage = '';
	let runResult = '';

	async function act(action: () => Promise<void>, running = false) {
		if (pending) return;
		pending = true;
		errorMessage = '';
		runResult = '';
		try {
			await action();
			if (running) runResult = allowTestRun ? 'Command finished.' : 'Command sent.';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			pending = false;
		}
	}
</script>

<article class="command-card">
	<button
		type="button"
		class="command-summary"
		aria-label={`Edit ${command.name}`}
		disabled={pending}
		on:click={() => {
			popup = true;
		}}
	>
		<span class="command-name">{command.name}</span>
		<span class="command-aliases"
			>{command.aliases?.length ? command.aliases.join(' · ') : 'No voice aliases'}</span
		>
		<code>{command.command}</code>
	</button>
	<div class="command-actions">
		<button
			type="button"
			class="editor-button"
			disabled={pending || !canRun}
			title={!canRun ? 'Save device changes before running this command' : `Run ${command.name}`}
			on:click={() => act(() => runCommand(command), true)}>{pending ? 'Working…' : 'Run'}</button
		>
		<button
			type="button"
			class="editor-icon-button"
			aria-label={`Delete ${command.name}`}
			disabled={pending}
			on:click={() => act(() => deleteCommand(command))}
		>
			<svg
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
				aria-hidden="true"
				><path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"
				/></svg
			>
		</button>
	</div>
	{#if errorMessage}<p role="alert" class="editor-error">{errorMessage}</p>{/if}
	{#if runResult}<p role="status" class="run-result">{runResult}</p>{/if}
</article>

<CommandPopup
	bind:visible={popup}
	type="Edit"
	{device}
	{runCommand}
	{allowTestRun}
	newCommand={command}
	saveCommand={updateCommands}
/>

<style>
	.command-card {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.5rem 0.75rem;
		min-width: 0;
		border: 1px solid rgb(255 255 255 / 0.08);
		border-radius: 0.875rem;
		background: #111114;
		padding: 0.875rem;
	}
	.command-summary {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
		text-align: left;
		padding: 0.25rem;
		border-radius: 0.375rem;
	}
	.command-summary:focus-visible {
		outline: 2px solid #818cf8;
		outline-offset: 3px;
	}
	.command-name {
		color: #f4f4f5;
		font-size: 0.875rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.command-summary:hover .command-name {
		color: #a5b4fc;
	}
	.command-aliases {
		color: #a1a1aa;
		font-size: 0.75rem;
		overflow-wrap: anywhere;
	}
	code {
		color: #818cf8;
		font-size: 0.75rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		width: 100%;
	}
	.command-actions {
		display: flex;
		gap: 0.375rem;
		align-items: center;
	}
	.command-card > :global(.editor-error) {
		grid-column: 1 / -1;
	}
	.run-result {
		grid-column: 1 / -1;
		color: #6ee7b7;
		font-size: 0.75rem;
	}
	@media (max-width: 440px) {
		.command-card {
			grid-template-columns: minmax(0, 1fr);
		}
		.command-actions {
			justify-content: flex-end;
		}
	}
</style>
