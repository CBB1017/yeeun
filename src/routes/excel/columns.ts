import type { Column, ColumnDef, Row, Table } from "@tanstack/table-core";
import { createRawSnippet } from "svelte";
import { renderComponent, renderSnippet } from "$ui/data-table/index.js";
import DataTableActions from "./data-table-actions.svelte";
import DataTableEmailButton from "./data-table-email-button.svelte";
import { Checkbox } from "$ui/checkbox";

export type ExcelRow = Record<string, any>;
export const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
  "select": 30,
  "차수": 90,
  "금액(지급액)": 150,
  "소속": 150,
  "성명": 80,
  "교번": 90,
  "신청번호": 100,
  "과제번호(계약번호)": 120,
  "연구업적구분": 100,
  "업적세부구분": 300,
  "신청자역할": 80,
  "연구제목": 300,
  "국내/국제": 80,
  "연구기간": 170,
  "연구마감(교원전산입력값)": 100,
  "과제물제출기한(국내)": 100,
  "과제물제출기한(국제)": 100,
  "변경신청여부": 100,
  "중간연구결과보고서제출": 100,
  "최종연구결과보고서제출(결과자료포함)": 100,
  "진행사항요약": 100,
  "비고": 100,
};
export function makeDynamicColumns(header: string[]): ColumnDef<Record<string, string>>[] {
  console.log(header.length);
  // const cleanedHeader = header.map(col => col.replace(/[\s\r\n]+/g, ''));
  const baseColumns = header.map((col) => {
    // 금액 포함된 컬럼은 포맷 셀 커스텀
    if (col.includes("금액")) {
      return {
        accessorKey: col,
        header: ({ column }: { column: Column<ExcelRow> }) =>
          renderComponent(DataTableEmailButton, {
            onclick: column.getToggleSortingHandler(),
            columnName: col,
            sorted: column.getIsSorted?.()
          }),
        cell: ({ row }: { row: Row<ExcelRow> }) => {
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
        header: ({ column }: { column: Column<ExcelRow> }) =>
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
    accessorKey: "select",
    header: ({ table }: { table: Table<ExcelRow> }) =>
      renderComponent(Checkbox, {
        checked: table.getIsAllPageRowsSelected(),
        indeterminate:
          table.getIsSomePageRowsSelected() &&
          !table.getIsAllPageRowsSelected(),
        onCheckedChange: (value) => table.toggleAllPageRowsSelected(!!value),
        "aria-label": "Select all",
      }),
    cell: ({ row }: { row: Row<ExcelRow> }) =>
      renderComponent(Checkbox, {
        checked: row.getIsSelected(),
        onCheckedChange: (value) => row.toggleSelected(!!value),
        "aria-label": "Select row",
      }),
    enableSorting: true,
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
