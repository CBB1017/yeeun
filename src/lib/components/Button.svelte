<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const buttonVariants = tv({
		base: 'inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] px-4 py-2 text-base font-semibold no-underline transition-colors duration-150 select-none disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
		variants: {
			variant: {
				primary: 'bg-primary text-primary-fg hover:bg-primary-hover hover:text-primary-fg',
				secondary: 'border border-[#94a3b8] bg-surface text-ink hover:bg-subtle hover:text-ink',
				danger: 'bg-danger text-danger-fg hover:bg-danger-hover hover:text-danger-fg',
				'danger-outline': 'border border-danger bg-surface text-danger hover:bg-danger-soft hover:text-danger',
				ghost: 'text-primary hover:bg-primary-soft hover:text-primary-hover'
			},
			size: {
				md: '',
				sm: 'px-3 text-sm'
			},
			full: { true: 'w-full', false: '' }
		},
		defaultVariants: { variant: 'secondary', size: 'md', full: false }
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	type Props = Omit<HTMLButtonAttributes, 'class'> & {
		variant?: ButtonVariant;
		size?: 'md' | 'sm';
		full?: boolean;
		href?: string;
		download?: string | boolean;
		target?: string;
		rel?: string;
		reload?: boolean;
		class?: string;
		children: Snippet;
	};

	let { variant = 'secondary', size = 'md', full = false, href, download, target, rel, reload = false, class: cls = '', children, type = 'button', ...rest }: Props = $props();
	const classes = $derived(buttonVariants({ variant, size, full, class: cls }));
</script>

{#if href}
	<a {href} {download} {target} {rel} class={classes} data-sveltekit-reload={reload ? '' : undefined} aria-label={rest['aria-label']} aria-describedby={rest['aria-describedby']} data-testid={rest['data-testid'] as string | undefined}>
		{@render children()}
	</a>
{:else}
	<button {type} class={classes} {...rest}>
		{@render children()}
	</button>
{/if}
