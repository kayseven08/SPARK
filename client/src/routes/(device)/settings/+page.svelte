<script lang="ts">
	import ApplicationSettings from '$lib/ApplicationSettings.svelte';
	import UserSettings from '$lib/UserSettings.svelte';

	import { onMount } from 'svelte';
	import { getStore, setStore } from '$lib/tauri';
	import type { Device, PublicUser } from '$lib';
	import { goto } from '$app/navigation';
	import { updateUserApi } from '$lib/api';
	import { getRequiredAccessToken, isPublicUserReady } from '$lib/storeAccess';

	let user: PublicUser = {
		email: '',
		username: 'default',
		id: '1',
		settings: { primaryCommunicationMethod: 'realtime' }
	};
	let device: Device = { id: '1', name: 'default' };
	let saving = false;
	let notice = '';
	let errorMessage = '';
	let accessToken: string = '';

	onMount(async () => {
		const u = await getStore('user');
		if (!isPublicUserReady(u)) {
			await goto('/login');
			return;
		}
		user = { ...u, settings: { ...u.settings } };
		device = (await getStore('device')) as Device;
		const token = await getRequiredAccessToken('/login');
		if (token) accessToken = token;
	});

	const saveSettings = async () => {
		if (saving) return;
		saving = true;
		notice = '';
		errorMessage = '';
		try {
			const response = await updateUserApi(user, accessToken);
			if (!response.ok) {
				const body = await response.json().catch(() => ({}));
				throw new Error(body.error ?? 'Could not save your settings.');
			}
			await setStore('user', user);
			notice = 'Settings saved.';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			saving = false;
		}
	};
</script>

<div class="min-h-screen p-4 md:p-8">
	<div class="max-w-4xl mx-auto space-y-6">
		<header>
			<h1 class="text-3xl font-bold text-white">Settings</h1>
			<p class="text-sm text-zinc-400 mt-2">Manage your profile and device preferences.</p>
		</header>
		<UserSettings bind:user />
		<ApplicationSettings />
		{#if errorMessage}<p class="editor-error" role="alert">{errorMessage}</p>{/if}
		{#if notice}<p class="text-sm text-emerald-300" role="status">{notice}</p>{/if}
		<div class="flex justify-end">
			<button type="button" class="editor-primary" disabled={saving} on:click={saveSettings}
				>{saving ? 'Saving…' : 'Save settings'}</button
			>
		</div>
	</div>
</div>
