<script context="module" lang="ts">
	let nextId = 0;
</script>

<script lang="ts">
	export let options: { value: string; label: string }[];
	export let legend: string;
	export let userSelected = options[0]?.value;
	export let fontSize = 16;
	export let flexDirection = 'column';
	const name = `radio-options-${++nextId}`;
</script>

<fieldset style={`font-size: ${fontSize}px`}>
	<legend>{legend}</legend>
	<div class="options" style={`flex-direction: ${flexDirection}`}>
		{#each options as option}
			<label
				><input type="radio" {name} value={option.value} bind:group={userSelected} /><span
					>{option.label}</span
				></label
			>
		{/each}
	</div>
</fieldset>

<style>
	fieldset {
		min-width: 0;
	}
	legend {
		font-size: 0.875em;
		font-weight: 600;
		margin-bottom: 0.75rem;
		color: #e4e4e7;
	}
	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.625rem;
	}
	label {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border: 1px solid rgb(255 255 255 / 0.12);
		border-radius: 0.75rem;
		cursor: pointer;
		background: #111114;
		color: #d4d4d8;
	}
	label:has(input:checked) {
		border-color: #818cf8;
		background: rgb(99 102 241 / 0.1);
		color: #f4f4f5;
	}
	input {
		accent-color: #818cf8;
		flex-shrink: 0;
	}
</style>
