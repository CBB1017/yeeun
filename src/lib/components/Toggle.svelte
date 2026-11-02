<script lang="ts">
	/** Native checkbox exposed as a switch: keyboard (Space), screen-reader state and 44px target. */
	type Props = {
		label: string;
		description?: string;
		checked: boolean;
		disabled?: boolean;
		onchange: (next: boolean) => void;
		id: string;
	};
	let { label, description, checked, disabled = false, onchange, id }: Props = $props();
</script>

<div class="flex items-start justify-between gap-4">
	<div class="min-w-0">
		<label for={id} class="font-semibold">{label}</label>
		{#if description}<p id="{id}-desc" class="hint">{description}</p>{/if}
	</div>
	<span class="relative inline-flex h-11 w-16 flex-none items-center justify-center">
		<input
			{id}
			type="checkbox"
			role="switch"
			class="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
			{checked}
			{disabled}
			aria-checked={checked}
			aria-describedby={description ? `${id}-desc` : undefined}
			onchange={(e) => onchange((e.currentTarget as HTMLInputElement).checked)}
		/>
		<span
			aria-hidden="true"
			class="pointer-events-none flex h-7 w-12 items-center rounded-full border-2 transition-colors duration-150 peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus peer-disabled:opacity-60 {checked ? 'border-primary bg-primary' : 'border-[#64748b] bg-surface'}"
		>
			<span class="block size-5 rounded-full transition-transform duration-150 {checked ? 'translate-x-[1.375rem] bg-white' : 'translate-x-0.5 bg-[#64748b]'}"></span>
		</span>
	</span>
</div>
<p class="mt-1 text-sm font-semibold {checked ? 'text-primary' : 'text-muted'}" aria-hidden="true">{checked ? '켜짐' : '꺼짐'}</p>
