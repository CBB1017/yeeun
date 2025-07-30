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
  await store.set('path', path);
  await store.set('sheets', sheets);
  await store.set('value', value);
  await store.set('columnWidths', columnWidths);
  await store.save();
}

export async function loadExcelState() {
  const path = await store.get<string>('path') ?? '';
  const sheets = await store.get<[string, string[][]][]>('sheets') ?? [];
  const value = await store.get<string>('value') ?? '0';
  const loadedWidths = await store.get<Record<string, number>>('columnWidths') ?? {};
  return { path, sheets, value, columnWidths: loadedWidths };
}