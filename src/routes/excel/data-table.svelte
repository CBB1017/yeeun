<script generics="TData, TValue" lang="ts">
  import {
    type ColumnDef,
    type PaginationState,
    type SortingState,
    type ColumnFiltersState,
    type VisibilityState,
    type RowSelectionState,
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    getFilteredRowModel,
  } from "@tanstack/table-core";
  import * as DropdownMenu from "$ui/dropdown-menu";
  import ArrowUpDownIcon from "@lucide/svelte/icons/arrow-up-down";
  import type { Table as TanTable } from '@tanstack/table-core';
  import { Separator } from "$ui/separator";
  import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "$ui/tooltip";
  import { Input } from "$ui/input";
  import { columnWidths } from '$lib/column-store';
  import {
    createSvelteTable,
    FlexRender,
  } from "$ui/data-table/index.js";
  import * as Table from "$ui/table";
  import { Button } from "$ui/button";
  import { DEFAULT_COLUMN_WIDTHS, type ExcelRow } from "./columns";
  import { onMount } from "svelte";

  const handleResizeStart = ( e: MouseEvent, col: string ) => {
    const startX = e.clientX;
    const startWidth = $columnWidths[col] || 120;

    function onMouseMove ( ev: MouseEvent ) {
      const delta = ev.clientX - startX;
      columnWidths.update( current => ({ ...current, [col]: Math.max( 60, startWidth + delta ) }) );
    }

    function onMouseUp () {
      window.removeEventListener( "mousemove", onMouseMove );
      window.removeEventListener( "mouseup", onMouseUp );
    }

    window.addEventListener( "mousemove", onMouseMove );
    window.addEventListener( "mouseup", onMouseUp );
  }
  type DataTableProps<TData, TValue> = {
    columns: ColumnDef<TData, TValue>[];
    data: TData[];
  };
  let { data, columns }: DataTableProps<ExcelRow, TValue> = $props();
  const getDefaultWidth = ( colName: string ) => {
    return Math.max( 100, colName.length * 12 + 32 );
  };
  /** reactive states for table */
  let table: TanTable<ExcelRow> = $state<TanTable<ExcelRow>>(createSvelteTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel()
  }));
  $effect( () => {
     table = createSvelteTable( {
      get data () {
        return filteredData;
      },
      columns,
      getCoreRowModel: getCoreRowModel(),
      getPaginationRowModel: getPaginationRowModel(),
      getSortedRowModel: getSortedRowModel(),
      getFilteredRowModel: getFilteredRowModel(),
      onPaginationChange: ( updater ) => {
        if ( typeof updater === "function" ) {
          pagination = updater( pagination );
        } else {
          pagination = updater;
        }
      },
      onSortingChange: ( updater ) => {
        if ( typeof updater === "function" ) {
          sorting = updater( sorting );
        } else {
          sorting = updater;
        }
      },
      onColumnFiltersChange: ( updater ) => {
        if ( typeof updater === "function" ) {
          columnFilters = updater( columnFilters );
        } else {
          columnFilters = updater;
        }
      },
      onColumnVisibilityChange: ( updater ) => {
        if ( typeof updater === "function" ) {
          columnVisibility = updater( columnVisibility );
        } else {
          columnVisibility = updater;
        }
      },
      onRowSelectionChange: ( updater ) => {
        if ( typeof updater === "function" ) {
          rowSelection = updater( rowSelection );
        } else {
          rowSelection = updater;
        }
      },
      state: {
        get pagination () {
          return pagination;
        },
        get sorting () {
          return sorting;
        },
        get columnFilters () {
          return columnFilters;
        },
        get columnVisibility () {
          return columnVisibility;
        },
        get rowSelection () {
          return rowSelection;
        },
      },
    } );
    if ( columns ) {
      let updatedFlag = false;
      // $columnWidths로 현재 값 접근
      let updated = { ...$columnWidths };
      for ( const col of columns ) {
        const id = col.id ?? (typeof col.accessorKey === "string" ? col.accessorKey : undefined) ?? "COL";
        if ( !(id in updated) ) {
          updated[id] = getDefaultWidth( id );
          updatedFlag = true;
        }
      }
      // 값이 바뀐 경우에만 store 갱신
      if ( updatedFlag ) columnWidths.set( updated );
    }
  } );
  let pagination = $state<PaginationState>( { pageIndex: 0, pageSize: 10 } );
  let sorting = $state<SortingState>( [] );
  let columnFilters = $state<ColumnFiltersState>( [] );
  let columnVisibility = $state<VisibilityState>( {} );
  let rowSelection = $state<RowSelectionState>( {} );
  let globalFilter = $state( "" );

  let filteredData = $derived( globalFilter
    ? data.filter( row =>
      Object.values( row )
            .join( " " )
            .toLowerCase()
            .includes( globalFilter.toLowerCase() )
    )
    : data );

</script>
<div>
    <div class="flex items-center py-4">
        <Input
                class="max-w-xs mr-2"
                oninput={(e) => globalFilter = e.currentTarget.value}
                placeholder="Search all columns..."
                value={globalFilter}
        />
        <Button onclick={() => columnWidths.set({ ...DEFAULT_COLUMN_WIDTHS })}>컬럼 너비 초기화</Button>
        <DropdownMenu.Root>
            <DropdownMenu.Trigger>
                {#snippet child({props})}
                    <Button {...props} variant="outline" class="ml-auto">Columns</Button>
                {/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
                {#each table
                  .getAllColumns()
                  .filter((col) => col.getCanHide()) as column (column.id)}
                    <DropdownMenu.CheckboxItem
                            class="capitalize"
                            bind:checked={
                              () => column.getIsVisible(), (v) => column.toggleVisibility(!!v)
                            }
                    >
                        {column.id}
                    </DropdownMenu.CheckboxItem>
                {/each}
            </DropdownMenu.Content>
        </DropdownMenu.Root>
    </div>
    <div class="rounded-md border">
        <Table.Root style="table-layout:fixed;width:100%;">
            <Table.Header>
                {#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
                    <Table.Row>
                        {#each headerGroup.headers as header (header.id)}
                            <Table.Head
                                    colspan={header.colSpan}
                                    style="
                                        min-width:0;
                                        user-select:none;
                                        width:{$columnWidths[header.column.id] || getDefaultWidth(header.column.id)}px;
                                      "
                            >
                                <div class="relative w-full h-full min-w-0">
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger>
                                                {#if header.column.getCanSort?.()}

                                                    <FlexRender
                                                            content={header.column.columnDef.header}
                                                            context={header.getContext()}
                                                    />
                                                {/if}
                                            </TooltipTrigger>
                                            <TooltipContent class="max-w-xs break-words">
                                                <FlexRender
                                                        content={header.column.columnDef.header}
                                                        context={header.getContext()}
                                                />
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                    <Separator
                                            class="absolute top-0 right-0 bottom-0 bg-gray-200 rounded cursor-col-resize z-10"
                                            style="width: 4px;"
                                            orientation="vertical"
                                            aria-orientation="vertical"
                                            aria-label="Resize column"
                                            onmousedown={(e) => handleResizeStart(e, header.column.id)}
                                    />
                                </div>
                            </Table.Head>
                        {/each}
                    </Table.Row>
                {/each}

            </Table.Header>
            <Table.Body>
                {#each table.getRowModel().rows as row (row.id)}
                    <Table.Row data-state={row.getIsSelected() && "selected"}>
                        {#each row.getVisibleCells() as cell (cell.id)}
                            <Table.Cell
                                    class="p-1"
                                    style="width:{$columnWidths[cell.column.id]}px;"
                            >
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger>
                                            <div
                                                    class="
            overflow-hidden
            [display:-webkit-box]
            [-webkit-line-clamp:2]
            [-webkit-box-orient:vertical]
            line-clamp-2
            w-full
            max-w-full
            break-words
          "
                                            >
                                                <FlexRender
                                                        content={cell.column.columnDef.cell}
                                                        context={cell.getContext()}
                                                />
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <FlexRender
                                                    content={cell.column.columnDef.cell}
                                                    context={cell.getContext()}
                                            />
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </Table.Cell>
                        {/each}
                    </Table.Row>
                {:else}
                    <Table.Row>
                        <Table.Cell colspan={columns.length} class="h-24 text-center">
                            No results.
                        </Table.Cell>
                    </Table.Row>
                {/each}
            </Table.Body>
        </Table.Root>
    </div>
    <div class="flex items-center justify-end space-x-2 py-4">
        <Button
                disabled={!table.getCanPreviousPage()}
                onclick={() => table.previousPage()}
                size="sm"
                variant="outline"
        >
            Previous
        </Button>
        <Button
                disabled={!table.getCanNextPage()}
                onclick={() => table.nextPage()}
                size="sm"
                variant="outline"
        >
            Next
        </Button>
    </div>
</div>