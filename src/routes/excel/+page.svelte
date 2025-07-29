<script lang="ts">
  import * as Select from '$ui/select';
  import * as Table from '$ui/table';
  import * as Button from '$ui/button';
  import { open } from '@tauri-apps/plugin-dialog';
  import { invoke } from '@tauri-apps/api/core';
  type SheetEntry = [string, string[][]];
  let sheets: SheetEntry[] = [];
  let currentSheetIdx: number = 0;

  async function loadExcel () {
    const selected = await open( {
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      multiple: false
    } );
    if ( !selected || typeof selected !== 'string' ) return;
    sheets = await invoke<SheetEntry[]>( 'read_all_sheets', { filePath: selected } );
    currentSheetIdx = 0;
  }

  function handleValueChange(value: string) {
    currentSheetIdx = Number(value);
  }
</script>

<Button.Root onclick={() => loadExcel()}>엑셀 파일 선택</Button.Root>

{#if sheets.length > 0}
    <Select.Root type="single" onValueChange={handleValueChange}>
        <Select.Trigger class="w-60 mt-2"></Select.Trigger>
        <Select.Content>
            {#each sheets as [name], i}
                <Select.Item value={i.toString()} label={name}>
                    {name}
                </Select.Item>
            {/each}
        </Select.Content>
    </Select.Root>

    <Table.Root>
        <Table.Caption>A list of your recent invoices.</Table.Caption>
        <Table.Header>
            <Table.Row>
                {#each sheets[currentSheetIdx][1][0] as header}
                    <Table.Head>{header}</Table.Head>
                {/each}
            </Table.Row>
        </Table.Header>
        <Table.Body>
            {#each sheets[currentSheetIdx][1].slice(1) as row}
                <Table.Row>
                    {#each row as cell}
                        <Table.Cell>{cell}</Table.Cell>
                    {/each}
                </Table.Row>
            {/each}
        </Table.Body>
    </Table.Root>
{/if}
