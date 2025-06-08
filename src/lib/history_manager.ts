use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufReader, BufWriter, ErrorKind};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const SEARCH_HISTORY_FILENAME: &str = "search_history.json";
const RUN_HISTORY_FILENAME: &str = "run_history.json";

fn get_history_path(app_handle: &AppHandle, filename: &str) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .ok_or_else(|| "アプリのデータディレクトリを取得できませんでした。".to_string())?;

    if !app_data_dir.exists() {
        fs::create_dir_all(&app_data_dir)
            .map_err(|e| format!("アプリのデータディレクトリの作成に失敗しました: {}", e))?;
    }
    Ok(app_data_dir.join(filename))
}

fn load_history_internal(
    app_handle: &AppHandle,
    filename: &str,
) -> Result<Vec<String>, String> {
    let path = get_history_path(app_handle, filename)?;
    if !path.exists() {
        return Ok(Vec::new()); // ファイルが存在しない場合は空の履歴を返す
    }

    let file = fs::File::open(path).map_err(|e| format!("履歴ファイルを開けませんでした: {}", e))?;
    let reader = BufReader::new(file);
    serde_json::from_reader(reader).map_err(|e| format!("履歴の読み込みに失敗しました: {}", e))
}

fn save_history_internal(
    app_handle: &AppHandle,
    filename: &str,
    history: Vec<String>,
) -> Result<(), String> {
    let path = get_history_path(app_handle, filename)?;
    let file = fs::File::create(path).map_err(|e| format!("履歴ファイルを作成できませんでした: {}", e))?;
    let writer = BufWriter::new(file);
    serde_json::to_writer_pretty(writer, &history) // pretty形式で保存するとデバッグしやすいよ！
        .map_err(|e| format!("履歴の保存に失敗しました: {}", e))
}

// --- Tauri Commands ---

#[tauri::command]
pub async fn load_search_history(app_handle: AppHandle) -> Result<Vec<String>, String> {
    load_history_internal(&app_handle, SEARCH_HISTORY_FILENAME)
}

#[tauri::command]
pub async fn save_search_history(
    app_handle: AppHandle,
    history: Vec<String>,
) -> Result<(), String> {
    save_history_internal(&app_handle, SEARCH_HISTORY_FILENAME, history)
}

#[tauri::command]
pub async fn load_run_history(app_handle: AppHandle) -> Result<Vec<String>, String> {
    load_history_internal(&app_handle, RUN_HISTORY_FILENAME)
}

#[tauri::command]
pub async fn save_run_history(
    app_handle: AppHandle,
    history: Vec<String>,
) -> Result<(), String> {
    save_history_internal(&app_handle, RUN_HISTORY_FILENAME, history)
}