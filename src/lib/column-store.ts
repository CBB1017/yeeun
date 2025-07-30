import { writable } from 'svelte/store';

export let columnWidths = writable<Record<string, number>>({});