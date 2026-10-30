<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { getStore, initRealtime } from '$lib/tauri';
	import { fetchUserGroups } from '$lib/api';
	import { restoreAuthFromStore } from '$lib/auth';
	import { navOpen, deviceData } from '$lib/stores';
	import NavButton from '$lib/NavButton.svelte';
	import '../../app.css';

	let device: any = null;
	let user: any = null;
	let groups: any[] = [];
	let screenWidth: number = 0;

	onMount(async () => {
		navOpen.set(window.innerWidth >= 768);
		if (!(await restoreAuthFromStore())) return goto('/login');
		await initRealtime();
		[device, user] = await Promise.all([getStore('device'), getStore('user')]);
		if (!user) return goto('/setup');
		if (device) deviceData.set(device);

		const token = (await getStore('accessToken')) as string;
		const res = await fetchUserGroups(user.id, token);
		if (res.ok) groups = await res.json();
	});

	$: isMobile = screenWidth < 768;
	$: pages = device
		? [
				{
					name: ($deviceData.id === device.id ? $deviceData.name : device.name) || 'This Device',
					url: '/this-device',
					icon: 'device'
				},
				{ name: 'Dashboard', url: '/dashboard', icon: 'dashboard' },
				{ name: 'Clients', url: '/clients', icon: 'clients' },
				{ name: 'Servers', url: '/servers', icon: 'servers' },
				{ name: 'Commands', url: '/commands', icon: 'commands' },
				{ name: 'Settings', url: '/settings', icon: 'settings' }
			]
		: [];
</script>

<svelte:window bind:innerWidth={screenWidth} />

<div
	class="h-screen w-screen flex flex-col md:flex-row overflow-hidden bg-dark-background-950 text-zinc-100 font-sans"
>
	<div
		class="absolute inset-0 bg-[radial-gradient(circle_at_30%_-20%,rgba(99,102,241,0.08),transparent_50%)] pointer-events-none"
	></div>
	<div
		class="absolute inset-0 bg-[radial-gradient(circle_at_80%_120%,rgba(168,85,247,0.05),transparent_50%)] pointer-events-none"
	></div>

	{#if isMobile && $navOpen}
		<button
			type="button"
			class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
			aria-label="Close navigation"
			on:click={() => navOpen.set(false)}
		></button>
	{/if}
	<nav
		aria-label="Main navigation"
		inert={isMobile && !$navOpen}
		class="
    {$navOpen
			? 'translate-x-0 md:w-64'
			: '-translate-x-full pointer-events-none md:w-20 md:translate-x-0 md:pointer-events-auto'} w-64
    lg:w-64 fixed left-0 top-0 md:relative z-50 h-full bg-dark-background-900/95 md:bg-dark-background-900/30 backdrop-blur-2xl border-r border-white/[0.04] transition-all duration-300 ease-in-out flex flex-col shadow-2xl"
	>
		<div class="flex items-center justify-between p-4 md:hidden">
			<span class="font-bold tracking-wide">SPARK.</span><button
				type="button"
				class="editor-icon-button"
				aria-label="Close navigation"
				on:click={() => navOpen.set(false)}>×</button
			>
		</div>
		<div class="p-8 hidden lg:flex items-center gap-3">
			<div
				class="w-8 h-8 rounded-lg bg-gradient-to-br from-dark-primary to-dark-accent flex items-center justify-center shadow-md shadow-dark-primary/20"
			>
				<svg
					class="w-4 h-4 text-white"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2.5"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M13 10V3L4 14h7v7l9-11h-7z"
					/></svg
				>
			</div>
			<h1 class="text-xl font-bold text-white tracking-tight">
				SPARK<span class="text-dark-accent">.</span>
			</h1>
		</div>

		<div class="flex-1 flex flex-col gap-1.5 px-4 pt-2 overflow-y-auto no-scrollbar">
			{#each pages as pageItem}
				<NavButton
					{...pageItem}
					type={pageItem.icon}
					selected={$page.url.pathname === pageItem.url}
					compact={!$navOpen && !isMobile && screenWidth < 1024}
					onclick={() => {
						if (isMobile) navOpen.set(false);
						goto(pageItem.url);
					}}
				/>
			{/each}

			{#if groups.length > 0}
				<div class="mt-6 px-3 mb-2 flex items-center gap-2">
					<p class="text-[10px] uppercase tracking-[0.25em] text-zinc-600 font-bold">Groups</p>
					<div class="h-[1px] bg-white/[0.04] flex-1"></div>
				</div>
				{#each groups as group}
					<NavButton
						name={group.name}
						url={`/group/${group.id}`}
						type="group"
						selected={$page.url.pathname === `/group/${group.id}`}
						onclick={() => {
							if (isMobile) navOpen.set(false);
							goto(`/group/${group.id}`);
						}}
						compact={!$navOpen && !isMobile && screenWidth < 1024}
					/>
				{/each}
			{/if}
		</div>
	</nav>

	<div class="flex min-h-0 min-w-0 flex-1 flex-col relative z-10">
		<header class="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3 md:hidden">
			<button
				type="button"
				class="editor-icon-button"
				aria-label="Open navigation"
				aria-expanded={$navOpen}
				on:click={() => navOpen.set(true)}
				><svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.7"
					aria-hidden="true"><path stroke-linecap="round" d="M4 6h16M4 12h16M4 18h16" /></svg
				></button
			><span class="font-semibold text-sm">SPARK</span>
		</header>
		<main class="min-w-0 min-h-0 flex-1 overflow-y-auto no-scrollbar">
			<slot />
		</main>
	</div>
</div>
