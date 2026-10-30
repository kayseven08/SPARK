<script lang="ts">
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { getStore, runCommand } from '$lib/tauri';
	import type { Command, Device } from '$lib';
	import CommandCard from '$lib/CommandCard.svelte';
	import CreateCommandPopup from '$lib/CommandPopup.svelte';
	import { updateDeviceApi, getDeviceApi } from '$lib/api';
	import { goto } from '$app/navigation';
	import { replaceCommand } from '$lib/commandEditing';
	import { isDeviceReady } from '$lib/storeAccess';

	let device: Device = { deviceCommands: [] };
	let accessToken = '';
	let createCommandPopup = false;
	let newCommand: Command = { name: '', command: '', aliases: [''] };
	let loading = true;

	onMount(async () => {
		const d = await getStore('device');
		if (!isDeviceReady(d)) {
			await goto('/setup');
			loading = false;
			return;
		}
		device = (await getDeviceApi(d.id!, d.type ?? 'client', '')) ?? d;
		accessToken = (await getStore('accessToken')) as string;
		loading = false;
	});

	async function saveCommands(commands: Command[]) {
		const updated = { ...device, deviceCommands: commands };
		const res = await updateDeviceApi(updated, accessToken, device.id);
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new Error(body.error ?? 'Could not save command changes.');
		}
		device = updated;
	}

	async function saveEditedCommand(command: Command, original?: Command) {
		await saveCommands(replaceCommand(device.deviceCommands ?? [], command, original));
	}

	async function deleteCommand(command: Command) {
		await saveCommands((device.deviceCommands ?? []).filter((item) => item !== command));
	}
</script>

<div class="min-h-screen w-full bg-dark-background-900 p-4 md:p-8 overflow-y-auto">
	{#if loading}
		<div class="max-w-4xl mx-auto space-y-6 animate-pulse" aria-busy="true">
			<div class="h-10 bg-white/5 rounded w-2/5"></div>
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				{#each [1, 2, 3] as _}
					<div class="h-32 rounded-3xl bg-dark-background-600/50"></div>
				{/each}
			</div>
		</div>
	{:else}
		<div class="max-w-4xl mx-auto" in:fly={{ y: 20, duration: 400 }}>
			<header class="flex flex-wrap items-end justify-between gap-4 mb-8">
				<div>
					<h1 class="text-3xl font-bold text-dark-primary tracking-tight">System Commands</h1>
					<p class="text-sm text-gray-500 mt-1">
						Executing on <span class="text-dark-accent font-mono">{device.name}</span>
					</p>
				</div>
				<button
					class="px-5 py-2.5 bg-dark-primary text-white rounded-xl font-bold text-sm hover:scale-105 transition-all shadow-lg shadow-dark-primary/20"
					on:click={() => (createCommandPopup = true)}
				>
					+ New Command
				</button>
			</header>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				{#each device.deviceCommands || [] as command}
					<CommandCard
						{command}
						{device}
						{runCommand}
						updateCommands={(updated) => saveEditedCommand(updated, command)}
						{deleteCommand}
					/>
				{:else}
					<div class="spark-card p-8 text-center md:col-span-2">
						<p class="text-zinc-200">No commands configured</p>
						<p class="text-sm text-zinc-400 mt-2">
							Create a command to start controlling this device.
						</p>
					</div>
				{/each}
			</div>
		</div>

		<CreateCommandPopup
			bind:visible={createCommandPopup}
			{device}
			{newCommand}
			saveCommand={(command) => saveEditedCommand(command)}
		/>
	{/if}
</div>
