import type { ColumnDef } from "@tanstack/table-core";
import { createRawSnippet } from "svelte";
import { renderComponent, renderSnippet } from "$ui/data-table/index.js";
import DataTableActions from "./data-table-actions.svelte";
import DataTableEmailButton from "./data-table-email-button.svelte";
import { Checkbox } from "$ui/checkbox";

export type ExcelRow = Record<string, any>;

export function makeDynamicColumns(header: string[]): ColumnDef<Record<string, string>>[] {
  const baseColumns = header.map((col) => {
    // 금액 포함된 컬럼은 포맷 셀 커스텀
    if (col.includes("금액")) {
      return {
        accessorKey: col,
        header: ({ column }) =>
          renderComponent(DataTableEmailButton, {
            onclick: column.getToggleSortingHandler(),
            columnName: col,
            sorted: column.getIsSorted?.()
          }),
        cell: ({ row }) => {
          const value = row.getValue(col);
          const formatted = new Intl.NumberFormat("ko-KR").format(Number(value));
          const snippet = createRawSnippet<[string]>((getAmount) => {
            const amount = getAmount();
            return {
              render: () => `<div class="text-right font-medium">${amount}</div>`,
            };
          });
          return renderSnippet(snippet, formatted);
        },
        enableSorting: true,
        enableColumnFilter: true,
      };
    } else {
      // 일반 컬럼
      return {
        accessorKey: col,
        header: ({ column }) =>
          renderComponent(DataTableEmailButton, {
            onclick: column.getToggleSortingHandler(),
            columnName: col,
            sorted: column.getIsSorted?.()
          }),
        enableSorting: true,
        enableColumnFilter: true,
      };
    }
  });
  const selectColumn = {
    id: "select",
    header: ({ table }) =>
      renderComponent(Checkbox, {
        checked: table.getIsAllPageRowsSelected(),
        indeterminate:
          table.getIsSomePageRowsSelected() &&
          !table.getIsAllPageRowsSelected(),
        onCheckedChange: (value) => table.toggleAllPageRowsSelected(!!value),
        "aria-label": "Select all",
      }),
    cell: ({ row }) =>
      renderComponent(Checkbox, {
        checked: row.getIsSelected(),
        onCheckedChange: (value) => row.toggleSelected(!!value),
        "aria-label": "Select row",
      }),
    enableSorting: false,
    enableHiding: false,
  };

  // selectColumn을 배열 맨 앞에 추가 (스프레드!)
  return [selectColumn, ...baseColumns];
}

export function sheetRowsToObjects(header: string[], rows: string[][]) {
  return rows.map((row, idx) => {
    const obj: Record<string, string> = {};
    header.forEach((k, i) => {
      obj[k] = row[i] ?? "";
    });
    obj["id"] = `${idx}`; // id 필요시
    return obj;
  });
}
