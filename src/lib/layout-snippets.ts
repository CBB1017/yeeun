import { setContext, getContext } from 'svelte';
import type { Snippet } from 'svelte';

type Slots = {
  sidebar?: Snippet;
  header?: Snippet;
  children?: Snippet;
};

const key = Symbol();

export function initSlots(): Slots {
  const slots: Slots = {};
  setContext(key, slots);
  return slots;
}

export function setSlots(slots: Partial<Slots>) {
  const context = getContext<Slots>(key);
  Object.assign(context, slots);
}

export function useSlots(): Slots {
  return getContext<Slots>(key);
}
