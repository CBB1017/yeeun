import type { ColumnDef } from "@tanstack/table-core";
import { createRawSnippet } from "svelte";
import { renderComponent, renderSnippet } from "$ui/data-table/index.js";
import DataTableActions from "./data-table-actions.svelte";
import DataTableEmailButton from "./data-table-email-button.svelte";
import { Checkbox } from "$ui/checkbox";

export type ExcelRow = Record<string, any>;

export function makeDynamicColumns(header: string[]): ColumnDef<Record<string, string>>[] {
  return header.map((col) => {
    // 금액 포함된 컬럼은 포맷 셀 커스텀
    if (col.includes("금액")) {
      return {
        accessorKey: col,
        header: ({ column }) =>
          renderComponent(DataTableEmailButton, {
            onclick: column.getToggleSortingHandler(),
            columnName: col,
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
          }),
        enableSorting: true,
        enableColumnFilter: true,
      };
    }
  });
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

export const columns: ColumnDef<ExcelRow>[] = [
  {
    accessorKey: "amount",
    header: () => {
      const amountHeaderSnippet = createRawSnippet(() => ({
        render: () => `<div class="text-right">Amount</div>`,
      }));
      return renderSnippet(amountHeaderSnippet, "");
    },
    cell: ({ row }) => {
      const formatter = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      });

      const amountCellSnippet = createRawSnippet<[string]>((getAmount) => {
        const amount = getAmount();
        return {
          render: () => `<div class="text-right font-medium">${amount}</div>`,
        };
      });

      return renderSnippet(
        amountCellSnippet,
        formatter.format(parseFloat(row.getValue("amount")))
      );
    },
  },
  {
    id: "actions",
    cell: ({ row }) => {
      // You can pass whatever you need from `row.original` to the component
      return renderComponent(DataTableActions, { id: row.original.id });
    },
  },
  {
    accessorKey: "소속",
    header: ({ column }) =>
      renderComponent(DataTableEmailButton, {
        onclick: column.getToggleSortingHandler(),
      }),
  },
  {
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
  },
];
