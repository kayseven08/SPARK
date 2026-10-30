<script lang="ts">
	export let values: string[] = [];
	export let disabled = false;
	export let label = 'Voice aliases';
</script>

<fieldset class="editor-field" {disabled}>
	<legend class="editor-label">{label}</legend>
	<p class="editor-helper">
		Alternative phrases you can use to refer to this {label === 'Device aliases'
			? 'device'
			: 'command'}.
	</p>
	<div class="alias-list">
		{#each values as value, i}
			<div class="alias-row">
				<input
					class="editor-input"
					aria-label={`${label} ${i + 1}`}
					placeholder="e.g. open my browser"
					bind:value={values[i]}
				/>
				<button
					type="button"
					class="editor-icon-button"
					aria-label={`Remove alias ${i + 1}`}
					on:click={() => {
						values = values.filter((_, index) => index !== i);
					}}
				>
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.7"
						aria-hidden="true"><path stroke-linecap="round" d="m6 6 12 12M6 18 18 6" /></svg
					>
				</button>
			</div>
		{/each}
	</div>
	<button
		type="button"
		class="editor-button alias-add"
		on:click={() => {
			values = [...values, ''];
		}}>+ Add alias</button
	>
</fieldset>

<style>
	.alias-list {
		display: grid;
		gap: 0.5rem;
	}
	.alias-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.5rem;
	}
	.alias-add {
		align-self: flex-start;
	}
</style>
