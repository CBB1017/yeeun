<script lang="ts">
  import * as Select from '$ui/select';
  import * as Table from '$ui/table';
  import * as Button from '$ui/button';
  import { open } from '@tauri-apps/plugin-dialog';
  import { invoke } from '@tauri-apps/api/core';
  import { loadExcelState, saveExcelState } from '$lib/excel-store';
  import { onMount } from "svelte";
  import DataTable from "./data-table.svelte";
  import { makeDynamicColumns, sheetRowsToObjects } from "./columns";
  import { columnWidths } from '$lib/column-store';

  type SheetEntry = [string, string[][]];
  let sheets = $state<SheetEntry[]>( [] );
  let value = $state( '0' );
  let selectedPath = $state(""); // 파일 경로 표시용
  // --- 최초 진입 시 Store에서 복원 ---
  onMount(() => {
    async function load() {
      const loaded = await loadExcelState();
      sheets = loaded.sheets;
      value = loaded.value;
      selectedPath = loaded.path;
      columnWidths.update(current => ({ ...current, ...loaded.columnWidths }));
    }
    load();
  });
  async function loadExcel () {
    const selected = await open( {
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      multiple: false
    } );
    if ( !selected ) return;
    sheets = await invoke<SheetEntry[]>( 'read_all_sheets', { filePath: selected } );
    value = '0';
    selectedPath = selected; // 경로 저장
    await saveExcelState({ path: selectedPath, sheets, value, columnWidths: $columnWidths });
  }
  // --- 값이 바뀔 때마다 자동 저장 ---
  $effect(() => {
    console.log('header:', header);
    console.log('rowData:', rowData);
    console.log('data:', data); // sheetRowsToObjects 결과
    if ($columnWidths && sheets.length > 0) {
      saveExcelState({
        path: selectedPath,
        sheets,
        value,
        columnWidths: $columnWidths,
      });
    }
  });

  // 엑셀 데이터: sheets, value
  let header = $derived(sheets.length > 0 ? [...sheets[Number(value)][1][0]] : []);
  let rowData = $derived(sheets.length > 0 ? sheets[Number(value)][1].slice(1) : []);
  let columns = $derived(makeDynamicColumns([...header]));
  let data = $derived(sheetRowsToObjects(header, rowData));

</script>
<div class="flex flex-col flex-1 min-h-0 min-w-0 overflow-auto">
    <!-- 상단: 파일 선택 바(한줄 배치 + 패딩) -->
    <div class="flex items-center gap-2 p-4 bg-white border-b">
        <input
                class="flex-1 px-3 py-2 border rounded bg-gray-100 text-sm text-gray-700"
                type="text"
                value={selectedPath}
                readonly
                placeholder="엑셀 파일을 선택하세요"
                style="min-width: 0;"
        />
        <Button.Root class="whitespace-nowrap" onclick={loadExcel}>
            엑셀 파일 선택
        </Button.Root>
    </div>

    <!-- 컨텐츠: 적당한 패딩, 아래는 전부 꽉차는 테이블/셀렉트 영역 -->
    <div class="flex-1 min-h-0 min-w-0 p-6">
        {#if sheets.length > 0}
            <Select.Root type="single" bind:value>
                <Select.Trigger class="w-60 mt-2 mb-4">
                    {sheets[Number(value)][0]}
                </Select.Trigger>
                <Select.Content>
                    {#each sheets as [name], i}
                        <Select.Item value={i.toString()} label={name}>
                            {name}
                        </Select.Item>
                    {/each}
                </Select.Content>
            </Select.Root>

            <!-- 테이블: 스크롤 + 꽉차게 -->
            <div class="flex-1 min-h-0 min-w-0 overflow-auto">
                <div class="w-full min-w-0 overflow-x-auto h-full">
                    <DataTable {columns} {data} />
                </div>
            </div>
        {/if}
    </div>
</div>
