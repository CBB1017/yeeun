<script lang="ts">
  import * as Select from '$ui/select';
  import * as Table from '$ui/table';
  import * as Button from '$ui/button';
  import { open } from '@tauri-apps/plugin-dialog';
  import { invoke } from '@tauri-apps/api/core';
  import { columnWidths } from '$lib/column-store';
  import ChartAreaInteractive from "$lib/components/chart-area-interactive.svelte";
  import SectionCards from "$lib/components/section-cards.svelte";
  import DataTable from "$lib/components/data-table.svelte";
  import data from "./data"
</script>

<div class="flex flex-1 flex-col">
    <div class="@container/main flex flex-1 flex-col gap-2">
        <div class="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            <SectionCards />
            <div class="px-4 lg:px-6">
                <ChartAreaInteractive />
            </div>
            <DataTable {data} />
        </div>
    </div>
</div>