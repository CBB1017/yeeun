<script generics="TValue" lang="ts">
  import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '$ui/tooltip';
  import { FlexRender } from '$ui/data-table/index.js';
  import { columnWidths } from "$lib/column-store";
  import type { Cell } from "@tanstack/table-core";
  import type { ExcelRow } from "./columns";

  let { cell, showTooltip = false, container = $bindable()} = $props<{
    cell: Cell<ExcelRow, TValue>,
    showTooltip?: boolean,
    container?: HTMLDivElement | null
  }>();

  // container를 부모에게 노출
  export { container };
</script>
{#if showTooltip}
    <TooltipProvider>
        <Tooltip>
            <TooltipTrigger>
                <div
                        role="presentation"
                        bind:this={container}
                        class="overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] line-clamp-2 w-full max-w-full break-words"
                        style="width: {$columnWidths[cell.column.id]}px;"
                >
                    <FlexRender content={cell.column.columnDef.cell} context={cell.getContext()}/>
                </div>
            </TooltipTrigger>
            <TooltipContent>
                <FlexRender content={cell.column.columnDef.cell} context={cell.getContext()}/>
            </TooltipContent>
        </Tooltip>
    </TooltipProvider>
{:else}
    <div
            role="presentation"
            bind:this={container}
            class="overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] line-clamp-2 w-full max-w-full break-words"
            style="width: {$columnWidths[cell.column.id]}px;"
    >
        <FlexRender content={cell.column.columnDef.cell} context={cell.getContext()}/>
    </div>
{/if}