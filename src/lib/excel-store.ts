// src/lib/storeExcel.ts
import { load } from '@tauri-apps/plugin-store';
import { columnWidths } from './column-store';
import { get } from 'svelte/store';
const store = await load('excel-state.json', { autoSave: 1000 * 10 });

export async function saveExcelState({ path, sheets, value, columnWidths }: {
  path: string;
  sheets: [string, string[][]][];
  value: string;
  columnWidths: Record<string, number>;
}) {
  console.log('saving excel state');
  await Promise.all([
    store.set('path', path),
    store.set('sheets', sheets),
    store.set('value', value),
    store.set('columnWidths', columnWidths),
  ]);
  await store.save();
  console.log('saving end excel state');

}

export async function loadExcelState() {
  const [path, sheets, value, loadedWidths] = await Promise.all([
    store.get<string>('path'),
    store.get<[string, string[][]][]>('sheets'),
    store.get<string>('value'),
    store.get<Record<string, number>>('columnWidths'),
  ]);
  return {
    path: path ?? '',
    sheets: sheets ?? [],
    value: value ?? '0',
    columnWidths: loadedWidths ?? {},
  };
}