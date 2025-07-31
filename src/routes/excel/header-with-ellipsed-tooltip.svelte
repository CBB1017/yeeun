<script generics="TValue" lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '$ui/tooltip';
  import { FlexRender } from '$ui/data-table/index.js';
  import { columnWidths } from "$lib/column-store";
  import type { Header } from "@tanstack/table-core";
  import type { ExcelRow } from "./columns";
  import { checkEllipsed } from "$lib/utils";
  import { get } from "svelte/store";

  let container: HTMLDivElement | null = $state( null );
  let showTooltip = $state( false );
  let { header }: { header: Header<ExcelRow, TValue> } = $props()
  // columnWidths 변경 감지해서 tooltip 상태 업데이트
  function updateTooltipState() {
    if (container) {
      checkEllipsed(container).then(isEllipsed => {
        showTooltip = isEllipsed;
      });
    }
  }

  // columnWidths 변경 감지해서 tooltip 상태 업데이트
  $effect(() => {
    // 오직 columnWidth 변경만 추적
    $columnWidths[header.column.id];

    // 상태 업데이트는 untrack으로 감싸기
    untrack(() => {
      updateTooltipState();
    });
  });

  // 초기 마운트 시 tooltip 상태 설정
  onMount(() => {
    updateTooltipState();
  });
</script>
{#if showTooltip}
    <TooltipProvider>
        <Tooltip>
            <TooltipTrigger>
                <div
                        role="presentation"
                        bind:this={container}
                        class="overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] line-clamp-2 w-full max-w-full break-words"
                        style="width: {$columnWidths[header.column.id]}px;"
                >
                    <FlexRender content={header.column.columnDef.header} context={header.getContext()}/>
                </div>
            </TooltipTrigger>
            <TooltipContent>
                <FlexRender content={header.column.columnDef.header} context={header.getContext()}/>
            </TooltipContent>
        </Tooltip>
    </TooltipProvider>
{:else}
    <div
            role="presentation"
            bind:this={container}
            class="overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] line-clamp-2 w-full max-w-full break-words"
            style="width: {$columnWidths[header.column.id]}px;"
    >
        <FlexRender content={header.column.columnDef.header} context={header.getContext()}/>
    </div>
{/if}