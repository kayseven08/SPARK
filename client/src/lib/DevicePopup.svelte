<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { Command, Device, Message } from '$lib';
	import Modal from './Modal.svelte';
	import AliasEditor from './AliasEditor.svelte';
	import CommandCard from './CommandCard.svelte';
	import CommandPopup from './CommandPopup.svelte';
	import { deviceData } from './stores';
	import { copyDevice, replaceCommand } from './commandEditing';
	import { updateDeviceApi, deleteMessageApi, getDeviceMessagesApi } from '$lib/api';

	export let device: Device = {};
	export let thisDevice: Device = {};
	export let visible = false;
	export let accessToken = '';
	export let runCommand: (command: Command) => Promise<void>;

	const dispatch = createEventDispatcher();
	let draft = copyDevice({});
	let messages: Message[] = [];
	let errorMessage = '';
	let messageError = '';
	let loadingMessages = false;
	let saving = false;
	let deletingMessage = '';
	let createCommandPopup = false;
	let wasVisible = false;
	let requestId = 0;

	$: if (visible !== wasVisible) {
		wasVisible = visible;
		if (visible) {
			draft = copyDevice(device);
			errorMessage = '';
			messageError = '';
			messages = device.messages ?? [];
			createCommandPopup = false;
			void loadMessages();
		}
	}
	$: localDevice = device.id === thisDevice.id;
	$: changed =
		JSON.stringify({ ...draft, messages: undefined }) !==
		JSON.stringify({ ...device, messages: undefined });

	function close() {
		visible = false;
	}

	async function loadMessages() {
		if (!device.id) return;
		const request = ++requestId;
		loadingMessages = true;
		messageError = '';
		try {
			const loaded = await getDeviceMessagesApi(device.id);
			if (request === requestId && visible) messages = loaded;
		} catch (error) {
			if (request === requestId) messageError = String(error);
		} finally {
			if (request === requestId) loadingMessages = false;
		}
	}

	async function save() {
		if (saving) return;
		errorMessage = '';
		if (!draft.name?.trim()) {
			errorMessage = 'Enter a device name.';
			return;
		}
		saving = true;
		try {
			const updated = {
				...draft,
				name: draft.name.trim(),
				aliases: [...new Set((draft.aliases ?? []).map((alias) => alias.trim()).filter(Boolean))]
			};
			const response = await updateDeviceApi(updated, accessToken, thisDevice.id);
			if (!response.ok) {
				const body = await response.json().catch(() => ({}));
				throw new Error(body.error ?? 'Could not save device changes.');
			}
			device = { ...updated, messages };
			if (localDevice) deviceData.set(updated);
			dispatch('saved', { device });
			close();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			saving = false;
		}
	}

	async function saveCommand(command: Command, original?: Command) {
		draft = {
			...draft,
			deviceCommands: replaceCommand(draft.deviceCommands ?? [], command, original)
		};
	}

	async function deleteCommand(command: Command) {
		draft = { ...draft, deviceCommands: draft.deviceCommands?.filter((item) => item !== command) };
	}

	async function removeMessage(id: string) {
		deletingMessage = id;
		messageError = '';
		try {
			if (!(await deleteMessageApi(id, accessToken)))
				throw new Error('Could not delete this message. Try again.');
			messages = messages.filter((message) => message.id !== id);
		} catch (error) {
			messageError = String(error);
		} finally {
			deletingMessage = '';
		}
	}
</script>

{#if visible}
	<Modal
		bind:open={visible}
		title="Device settings"
		description={device.name
			? `Manage ${device.name}, its commands, and recent messages.`
			: 'Configure this device.'}
		busy={saving}
		wide
	>
		<div class="device-grid">
			<section class="device-details" aria-label="Device details">
				<div class="editor-field">
					<label for="device-name" class="editor-label">Device name</label>
					<input
						id="device-name"
						class="editor-input"
						bind:value={draft.name}
						placeholder="e.g. My laptop"
						maxlength="80"
						required
						disabled={saving}
					/>
				</div>
				<fieldset class="editor-field" disabled={saving}>
					<legend class="editor-label">Device type</legend>
					<div class="device-type-options">
						<label
							><input type="radio" name="device-type" value="client" bind:group={draft.type} /><span
								>Client<small>Receives device commands</small></span
							></label
						>
						<label
							><input type="radio" name="device-type" value="server" bind:group={draft.type} /><span
								>Server<small>Hosts the voice assistant</small></span
							></label
						>
					</div>
				</fieldset>
				<AliasEditor label="Device aliases" bind:values={draft.aliases} disabled={saving} />
			</section>
			<section class="device-commands" aria-label="Device commands">
				<div class="section-heading">
					<div>
						<h3>Commands</h3>
						<p class="editor-helper">
							{draft.deviceCommands?.length ?? 0} configured for this device
						</p>
					</div>
					<button
						type="button"
						class="editor-button"
						disabled={saving}
						on:click={() => {
							createCommandPopup = true;
						}}>+ Add command</button
					>
				</div>
				{#if draft.deviceCommands?.length}
					<div class="command-list">
						{#each draft.deviceCommands as command}
							<CommandCard
								{command}
								device={draft}
								updateCommands={(updated) => saveCommand(updated, command)}
								{deleteCommand}
								{runCommand}
								allowTestRun={localDevice}
								canRun={localDevice || !changed}
							/>
						{/each}
					</div>
				{:else}<div class="empty-state">
						<p>No commands yet</p>
						<span>Add a command to give this device something to run.</span>
					</div>{/if}
				<p class="editor-helper">Command edits are applied when you save device changes.</p>
			</section>
		</div>
		<section class="message-section" aria-label="Recent messages">
			<div class="section-heading">
				<div>
					<h3>Recent messages</h3>
					<p class="editor-helper">Latest incoming and outgoing messages</p>
				</div>
				<button
					type="button"
					class="editor-button"
					disabled={loadingMessages || saving}
					on:click={loadMessages}>{loadingMessages ? 'Refreshing…' : 'Refresh'}</button
				>
			</div>
			{#if messageError}<p class="editor-error" role="alert">{messageError}</p>{/if}
			{#if loadingMessages && !messages.length}<p class="editor-helper" role="status">
					Loading messages…
				</p>
			{:else if messages.length}
				<div class="message-list">
					{#each [...messages].reverse() as message (message.id)}
						<article class="message-item">
							<div class="message-content">
								<div class="message-meta">
									<span>{message.to === device.id ? 'Received' : 'Sent'}</span><span
										>{message.status === 0
											? 'Pending'
											: message.status === 1
												? 'Handled'
												: 'Failed'}</span
									>
								</div>
								<p>{message.content}</p>
							</div>
							<button
								type="button"
								class="editor-icon-button"
								aria-label="Delete message"
								disabled={!!deletingMessage || saving}
								on:click={() => removeMessage(message.id)}
								><svg
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
								></button
							>
						</article>
					{/each}
				</div>
			{:else}<div class="empty-state">
					<p>No messages yet</p>
					<span>Messages will appear here when this device sends or receives a command.</span>
				</div>{/if}
		</section>
		{#if errorMessage}<p class="editor-error save-error" role="alert">{errorMessage}</p>{/if}
		<svelte:fragment slot="footer"
			><span class="editor-helper save-note"
				>{changed ? 'You have unsaved changes' : 'Changes stay local until you save'}</span
			><button type="button" class="editor-button" disabled={saving} on:click={close}>Cancel</button
			><button type="button" class="editor-primary" disabled={saving} on:click={save}
				>{saving ? 'Saving…' : 'Save changes'}</button
			></svelte:fragment
		>
	</Modal>
	<CommandPopup
		bind:visible={createCommandPopup}
		device={draft}
		{runCommand}
		allowTestRun={localDevice}
		{saveCommand}
	/>
{/if}

<style>
	.device-grid {
		display: grid;
		grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
		gap: 2rem;
	}
	.device-details,
	.device-commands {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	.section-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	h3 {
		color: #f4f4f5;
		font-size: 0.9375rem;
		font-weight: 600;
		line-height: 1.6;
	}
	.device-type-options {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}
	.device-type-options label {
		display: flex;
		align-items: flex-start;
		gap: 0.625rem;
		padding: 0.75rem;
		border: 1px solid rgb(255 255 255 / 0.12);
		border-radius: 0.65rem;
		cursor: pointer;
	}
	.device-type-options label:has(input:checked) {
		border-color: #818cf8;
		background: rgb(99 102 241 / 0.1);
	}
	.device-type-options input {
		accent-color: #818cf8;
		margin-top: 0.25rem;
		flex-shrink: 0;
	}
	.device-type-options span {
		font-size: 0.8125rem;
	}
	.device-type-options small {
		display: block;
		color: #a1a1aa;
		font-size: 0.6875rem;
		margin-top: 0.25rem;
		line-height: 1.5;
	}
	.command-list {
		display: grid;
		gap: 0.625rem;
	}
	.empty-state {
		padding: 1.5rem 1rem;
		border: 1px dashed #3f3f46;
		border-radius: 0.875rem;
		text-align: center;
	}
	.empty-state p {
		font-size: 0.875rem;
		color: #d4d4d8;
	}
	.empty-state span {
		display: block;
		margin-top: 0.4rem;
		color: #a1a1aa;
		font-size: 0.8125rem;
		line-height: 1.6;
	}
	.message-section {
		margin-top: 2rem;
		padding-top: 1.5rem;
		border-top: 1px solid rgb(255 255 255 / 0.08);
		display: grid;
		gap: 1rem;
	}
	.message-list {
		display: grid;
		gap: 0.5rem;
		max-height: 17rem;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.message-item {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		min-width: 0;
		background: #111114;
		border: 1px solid rgb(255 255 255 / 0.07);
		border-radius: 0.75rem;
		padding: 0.875rem;
	}
	.message-content {
		flex: 1;
		min-width: 0;
	}
	.message-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		color: #a1a1aa;
		font-size: 0.6875rem;
		margin-bottom: 0.375rem;
	}
	.message-item p {
		overflow-wrap: anywhere;
		color: #e4e4e7;
		font-size: 0.8125rem;
		line-height: 1.6;
	}
	.save-note {
		margin-right: auto;
	}
	.save-error {
		margin-top: 1rem;
	}
	@media (max-width: 800px) {
		.device-grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.device-commands {
			border-top: 1px solid rgb(255 255 255 / 0.08);
			padding-top: 1.5rem;
		}
	}
	@media (max-width: 600px) {
		.save-note {
			width: 100%;
		}
	}
</style>
