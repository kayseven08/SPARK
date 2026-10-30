<script lang="ts">
	import Modal from '$lib/Modal.svelte';
	import { goto } from '$app/navigation';
	import type { Device, PublicUser } from '$lib';
	import { deviceData } from '$lib/stores';
	import { getStore, setStore } from '$lib/tauri';
	import type { Group } from '$lib/supabase';
	import { onMount } from 'svelte';
	import { createGroupApi, deleteGroupApi, fetchUserGroups } from '$lib/api';
	import { getRequiredAccessToken, isPublicUserReady } from '$lib/storeAccess';

	let groups: Group[] = [];
	let loadingGroups = true;
	let disabled = true;
	let selectedGroup: Group | null = null;
	$: disabled = selectedGroup === null;
	let value = '';
	let user: PublicUser;
	let accessToken: string;

	onMount(async () => {
		const u = await getStore('user');
		if (!isPublicUserReady(u)) {
			await goto('/login');
			return;
		}
		user = u;
		const device = (await getStore('device')) as Device;
		if (device?.id && device.assignedUser) {
			await goto('/dashboard');
			return;
		}

		const token = await getRequiredAccessToken('/login');
		if (!token) return;
		accessToken = token;

		const res = await fetchUserGroups(user.id, accessToken);
		if (res.status === 200) {
			groups = await res.json();
		}
		loadingGroups = false;
	});

	async function handleContinue() {
		if (selectedGroup) {
			deviceData.set({
				...$deviceData,
				assignedGroup: { id: selectedGroup.id },
				assignedUser: { id: user.id }
			});
			await setStore('group', selectedGroup);
			await goto('/device-setup');
		}
	}

	async function deleteGroup(group: Group) {
		const res = await deleteGroupApi(group.id, accessToken);
		if (res.ok) {
			groups = groups.filter((g) => g !== group);
			if (selectedGroup?.id === group.id) selectedGroup = null;
		}
	}

	async function handleSubmit(name: string) {
		if (groupCreated) return;
		if (!name.trim()) {
			groupError = 'Enter a group name.';
			return;
		}
		groupCreated = true;
		groupError = '';
		try {
			const res = await createGroupApi(name, accessToken);
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Could not create the group.');
			groups = [...groups, data];
			selectedGroup = data;
			value = '';
			createGroupPopup = false;
		} catch (error) {
			groupError = error instanceof Error ? error.message : String(error);
		} finally {
			groupCreated = false;
		}
	}

	let createGroupPopup = false;
	let groupCreated = false;
	let groupError = '';
</script>

<svelte:head>
	<title>Select Group</title>
</svelte:head>
<div class="flex flex-col gap-8 w-full">
	<h1 class="text-3xl font-bold text-dark-primary text-center">Select a group</h1>
	<div class="overflow-auto max-h-96 space-y-3 w-full">
		{#if loadingGroups}
			<div class="space-y-3">
				{#each [1, 2, 3] as _}
					<div class="h-16 rounded-xl bg-dark-background-600/50 animate-pulse"></div>
				{/each}
			</div>
		{:else}
			{#each groups as group}
				<div
					class="relative rounded-xl border transition-all cursor-pointer {selectedGroup === group
						? 'border-dark-accent bg-dark-background-600 shadow-lg'
						: 'border-white/10 bg-dark-background-600/40 hover:border-dark-accent/40'}"
				>
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="p-4 pr-12 min-w-0"
						on:click={() => {
							selectedGroup = selectedGroup === group ? null : group;
						}}
					>
						<h2 class="text-lg font-semibold text-white text-left break-words">{group.name}</h2>
						<p class="text-sm text-gray-400 mt-1">
							{group.devices['server'].length} servers · {group.devices['client'].length} clients
						</p>
					</div>
					<button
						type="button"
						class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-red-400 transition-colors p-1"
						on:click|stopPropagation={async () => await deleteGroup(group)}
						aria-label="Delete group"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
							stroke-width="1.5"
							stroke="currentColor"
							class="size-5"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79"
							/>
						</svg>
					</button>
				</div>
			{/each}
			<button
				type="button"
				class="w-full rounded-xl border border-dashed border-white/20 p-4 text-left text-dark-accent hover:border-dark-accent/50 hover:bg-dark-background-800"
				on:click={() => {
					value = '';
					groupError = '';
					createGroupPopup = true;
				}}>+ Create a new group</button
			>
		{/if}
	</div>
	<div class="flex justify-between items-center gap-4 pt-4">
		<button
			type="button"
			class="text-dark-accent text-sm hover:underline"
			on:click={() => goto('/group-info')}
		>
			← Back
		</button>
		<button
			type="button"
			class="spark-btn-primary px-8 py-3 rounded-xl disabled:opacity-40"
			{disabled}
			on:click={async () => await handleContinue()}
		>
			Next →
		</button>
	</div>
</div>

{#if createGroupPopup}
	<Modal
		bind:open={createGroupPopup}
		title="Create group"
		description="Organize the devices your assistant can talk to."
		busy={groupCreated}
	>
		<form id="create-group-form" on:submit|preventDefault={() => handleSubmit(value)}>
			<div class="editor-field">
				<label class="editor-label" for="create-group-name">Group name</label><input
					id="create-group-name"
					class="editor-input"
					bind:value
					maxlength="80"
					placeholder="e.g. Home devices"
					required
					disabled={groupCreated}
				/>
			</div>
			{#if groupError}<p class="editor-error mt-4" role="alert">{groupError}</p>{/if}
		</form>
		<svelte:fragment slot="footer"
			><button
				type="button"
				class="editor-button"
				disabled={groupCreated}
				on:click={() => {
					createGroupPopup = false;
				}}>Cancel</button
			><button type="submit" form="create-group-form" class="editor-primary" disabled={groupCreated}
				>{groupCreated ? 'Creating…' : 'Create group'}</button
			></svelte:fragment
		>
	</Modal>
{/if}
