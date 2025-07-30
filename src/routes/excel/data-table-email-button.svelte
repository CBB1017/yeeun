<script lang="ts">
  import type { ComponentProps } from "svelte";
  import ArrowUpDownIcon from "@lucide/svelte/icons/arrow-up-down";
  import { Button } from "$lib/components/ui/button/index.js";
  import type { SortDirection } from "@tanstack/table-core";
  let { columnName = "", onclick, sorted = false, variant = "ghost", ...restProps }: { columnName?: string, sorted?: false | SortDirection } & ComponentProps<typeof Button> = $props();

</script>

<Button
        {variant}
        {...restProps}
        type="button"
        class="flex items-center gap-1 px-2 py-1 font-medium text-sm rounded w-full min-w-0 max-w-full select-none"
        onclick={onclick}
>
  <span class="block max-w-[180px] overflow-hidden whitespace-normal break-words [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] line-clamp-2 text-left text-ellipsis">
    {columnName}
  </span>
  {#if sorted}
    <span
            class="transition-transform"
            class:rotate-180={sorted === 'desc'}
    >
      <ArrowUpDownIcon
              class={"w-4 h-4 ml-1 flex-shrink-0 " + (sorted ? "text-blue-500" : "text-gray-400")}
      />
    </span>
  {/if}
</Button>