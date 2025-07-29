// Prevents an additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use calamine::{open_workbook_auto, Reader};
use std::fs;
use tauri::Builder;
use tauri_plugin_dialog::init as dialog_plugin;
#[tauri::command]
fn save_last_file_path(path: String) -> Result<(), String> {
    fs::write("last_file.txt", path).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_last_file_path() -> Option<String> {
    fs::read_to_string("last_file.txt").ok()
}

#[tauri::command]
fn read_all_sheets(file_path: String) -> Result<Vec<(String, Vec<Vec<String>>)>, String> {
    let mut workbook = open_workbook_auto(&file_path).map_err(|e| e.to_string())?;
    let mut result = Vec::new();

    for sheet_name in workbook.sheet_names().to_owned() {
        match workbook.worksheet_range(&sheet_name) {
            Ok(range) => {
                let data = range
                    .rows()
                    .map(|row| row.iter().map(|c| c.to_string()).collect())
                    .collect();
                result.push((sheet_name.clone(), data));
            }
            Err(e) => {
                eprintln!("❗ '{}' 시트 파싱 오류: {}", sheet_name, e);
            }
        }
    }

    result.reverse();
    Ok(result)
}

fn main() {
    Builder::default()
        .plugin(dialog_plugin())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            read_all_sheets,
            save_last_file_path,
            load_last_file_path
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri app");
}
