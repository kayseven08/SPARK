<script context="module" lang="ts">
	let nextFormId = 0;
</script>

<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { Device, Command } from '$lib';
	import Modal from './Modal.svelte';
	import AliasEditor from './AliasEditor.svelte';
	import { copyCommand, emptyCommand, normalizeCommand } from './commandEditing';
	import { runCommand as runLocalCommand, getStore } from './tauri';
	import { ensureAuthenticated } from './auth';
	import { supabase } from './supabase';
	import { getDefaultPresets } from './presets';

	export let runCommand: (command: Command) => Promise<void> = runLocalCommand;
	export let allowTestRun = true;
	export let device: Device = {};
	export let newCommand: Command = emptyCommand();
	export let saveCommand: (command: Command) => Promise<void>;
	export let visible = false;
	export let type: 'Create' | 'Edit' = 'Create';

	const dispatch = createEventDispatcher();
	const formId = `command-form-${++nextFormId}`;
	let draft = emptyCommand();
	let groupPresets: Command[] = [];
	let presets: Command[] = [];
	let showPresets = false;
	let errorMessage = '';
	let testResult = '';
	let saving = false;
	let testing = false;
	let wasVisible = false;
	let requestId = 0;

	$: if (visible !== wasVisible) {
		wasVisible = visible;
		if (visible) openEditor();
	}
	$: presets = [
		...groupPresets,
		...getDefaultPresets(typeof navigator !== 'undefined' ? navigator.platform : '')
	];

	function openEditor() {
		draft = copyCommand(newCommand);
		errorMessage = '';
		testResult = '';
		showPresets = false;
		groupPresets = [];
		void loadGroupPresets(++requestId);
	}

	async function loadGroupPresets(request: number) {
		try {
			const group = device.assignedGroup ?? ((await getStore('group')) as { id?: string } | null);
			if (!group?.id || !(await ensureAuthenticated())) return;
			const { data, error } = await supabase
				.from('command_presets')
				.select('name, command, aliases')
				.eq('assigned_group_id', group.id);
			if (request !== requestId || !visible) return;
			if (error) throw error;
			groupPresets = data ?? [];
		} catch {
			// Built-in presets stay available if the optional group lookup fails.
			groupPresets = [];
		}
	}

	function close() {
		visible = false;
		dispatch('close');
	}

	async function save() {
		if (saving || testing) return;
		errorMessage = '';
		saving = true;
		try {
			await saveCommand(normalizeCommand(draft));
			close();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			saving = false;
		}
	}

	async function testCommand() {
		if (saving || testing) return;
		errorMessage = '';
		testResult = '';
		testing = true;
		try {
			await runCommand(normalizeCommand(draft));
			testResult = 'Command finished successfully.';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			testing = false;
		}
	}
</script>

{#if visible}
	<Modal
		bind:open={visible}
		title={`${type} command`}
		description={device.name
			? `Configure a command for ${device.name}.`
			: 'Give your command a name, voice aliases, and shell instructions.'}
		busy={saving || testing}
		wide
		on:close={close}
	>
		<form id={formId} on:submit|preventDefault={save}>
			<div class="preset-toolbar">
				<p class="editor-helper">Start from scratch or choose a preset.</p>
				<button
					type="button"
					class="editor-button"
					aria-expanded={showPresets}
					disabled={saving || testing}
					on:click={() => {
						showPresets = !showPresets;
					}}>{showPresets ? 'Hide presets' : 'Browse presets'}</button
				>
			</div>
			{#if showPresets}
				<section class="preset-panel" aria-label="Command presets">
					{#each presets as preset}
						<button
							type="button"
							class="preset-option"
							on:click={() => {
								draft = { ...copyCommand(preset), id: draft.id };
								showPresets = false;
							}}
						>
							<span>{preset.name}</span><code>{preset.command}</code>
						</button>
					{/each}
				</section>
			{/if}
			<div class="command-grid">
				<div class="command-details">
					<div class="editor-field">
						<label class="editor-label" for={`${formId}-name`}>Command name</label>
						<input
							class="editor-input"
							id={`${formId}-name`}
							bind:value={draft.name}
							placeholder="e.g. Open browser"
							required
							disabled={saving || testing}
						/>
					</div>
					<AliasEditor bind:values={draft.aliases} disabled={saving || testing} />
				</div>
				<div class="editor-field command-code">
					<label class="editor-label" for={`${formId}-code`}>Shell command</label>
					<textarea
						class="editor-input"
						id={`${formId}-code`}
						bind:value={draft.command}
						placeholder="Enter the command to execute…"
						spellcheck="false"
						required
						disabled={saving || testing}
					></textarea>
					<p class="editor-helper">
						Runs on the selected device using its operating system’s shell.
					</p>
				</div>
			</div>
			{#if errorMessage}<p class="editor-error" role="alert">{errorMessage}</p>{/if}
			{#if testResult}<p class="test-result" role="status">{testResult}</p>{/if}
		</form>
		<svelte:fragment slot="footer">
			{#if allowTestRun}<button
					type="button"
					class="editor-button test-button"
					disabled={saving || testing || !draft.command.trim()}
					on:click={testCommand}>{testing ? 'Running…' : 'Test run'}</button
				>{/if}
			<button type="button" class="editor-button" disabled={saving || testing} on:click={close}
				>Cancel</button
			>
			<button type="submit" form={formId} class="editor-primary" disabled={saving || testing}
				>{saving ? 'Saving…' : 'Save command'}</button
			>
		</svelte:fragment>
	</Modal>
{/if}

<style>
	form {
		display: grid;
		gap: 1.5rem;
		min-width: 0;
	}
	.preset-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	.preset-panel {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
		max-height: 15rem;
		overflow-y: auto;
		padding: 0.75rem;
		background: #111114;
		border: 1px solid rgb(255 255 255 / 0.08);
		border-radius: 0.875rem;
	}
	.preset-option {
		min-width: 0;
		display: grid;
		gap: 0.3rem;
		padding: 0.75rem;
		text-align: left;
		border: 1px solid transparent;
		border-radius: 0.5rem;
	}
	.preset-option:hover,
	.preset-option:focus-visible {
		background: #202025;
		border-color: #6366f1;
		outline: none;
	}
	.preset-option span {
		font-size: 0.8125rem;
		color: #e4e4e7;
		font-weight: 600;
	}
	.preset-option code {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: #a1a1aa;
		font-size: 0.75rem;
	}
	.command-grid {
		display: grid;
		grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
		gap: 1.5rem;
	}
	.command-details {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		min-width: 0;
	}
	.command-code textarea {
		flex: 1;
		min-height: 17rem;
		resize: vertical;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		line-height: 1.8;
		tab-size: 2;
	}
	.test-button {
		margin-right: auto;
	}
	.test-result {
		color: #6ee7b7;
		font-size: 0.8125rem;
	}
	@media (max-width: 700px) {
		.command-grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.command-code textarea {
			min-height: 11rem;
		}
		.preset-panel {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
