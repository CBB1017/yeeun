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
  import { Separator } from "$ui/separator";
  import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "$ui/tooltip";
  import { Input } from "$ui/input";
  import {
    createSvelteTable,
    FlexRender,
  } from "$ui/data-table/index.js";
  import * as Table from "$ui/table";
  import { Button } from "$ui/button";
  import type { ExcelRow } from "./columns";
  import { onMount } from "svelte";
  // 컬럼 width state 예시
  let columnWidths = $state<Record<string, number>>( {} );

  const handleResizeStart = ( e: MouseEvent, col: string ) => {
    console.log( col )
    const startX = e.clientX;
    const startWidth = $derived( columnWidths[col] || 120 );

    function onMouseMove ( ev: MouseEvent ) {
      const delta = ev.clientX - startX;
      columnWidths = { ...columnWidths, [col]: Math.max( 60, startWidth + delta ) };
      console.log( $state.snapshot( columnWidths ) );
    }

    function onMouseUp () {
      console.log( 'test' )
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
    return Math.max( 100, colName.length * 3 + 32 );
  };

  $effect( () => {
    if ( columns ) {
      let updated = { ...columnWidths };
      let updatedFlag = false;
      for ( const col of columns ) {
        // col.id가 없으면 accessorKey 또는 fallback
        const id = col.id ?? (typeof col.accessorKey === "string" ? col.accessorKey : undefined) ?? "COL";
        if ( !(id in updated) ) {
          updated[id] = getDefaultWidth( id );
          updatedFlag = true;
        }
      }
      if ( updatedFlag ) columnWidths = updated;
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
  const table = createSvelteTable( {
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
</script>
<div>
    <div class="flex items-center py-4">
        <Input
                class="max-w-xs mr-2"
                oninput={(e) => globalFilter = e.currentTarget.value}
                placeholder="Search all columns..."
                value={globalFilter}
        />
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
                                        position:relative;
                                        min-width:0;
                                        max-width:380px;
                                        user-select:none;
                                        width:{columnWidths[header.column.id] || getDefaultWidth(header.column.id)}px;
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
                                            class="absolute top-0 right-0 bottom-0 my-2 bg-gray-200 rounded cursor-col-resize z-10"
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
                            <Table.Cell class="overflow-hidden text-ellipsis whitespace-nowrap">
                                <FlexRender
                                        content={cell.column.columnDef.cell}
                                        context={cell.getContext()}
                                />
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