use std::fs;
use std::io::{BufReader, BufWriter};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Wry}; // Manager を追加、AppHandle を AppHandle<Wry> に合わせることも考慮

const SEARCH_HISTORY_FILENAME: &str = "search_history.json";
const RUN_HISTORY_FILENAME: &str = "run_history.json";

fn get_history_path(app_handle: &AppHandle<Wry>, filename: &str) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get application data directory.");

    if !app_data_dir.exists() {
        fs::create_dir_all(&app_data_dir)
            .map_err(|e| format!("アプリのデータディレクトリの作成に失敗しました: {}", e))?;
    }
    Ok(app_data_dir.join(filename))
}

fn load_history_internal(
    app_handle: &AppHandle<Wry>,
    filename: &str,
) -> Result<Vec<String>, String> {
    let path = get_history_path(app_handle, filename)?; // & を削除
    if !path.exists() {
        return Ok(Vec::new()); // ファイルが存在しない場合は空の履歴を返す
    }

    let file = fs::File::open(path).map_err(|e| format!("履歴ファイルを開けませんでした: {}", e))?;
    let reader = BufReader::new(file);
    serde_json::from_reader(reader).map_err(|e| format!("履歴の読み込みに失敗しました: {}", e))
}

fn save_history_internal(
    app_handle: &AppHandle<Wry>,
    filename: &str,
    history: Vec<String>,
) -> Result<(), String> {
    let path = get_history_path(app_handle, filename)?; // & を削除
    let file = fs::File::create(path).map_err(|e| format!("履歴ファイルを作成できませんでした: {}", e))?;
    let writer = BufWriter::new(file);
    serde_json::to_writer_pretty(writer, &history) // pretty形式で保存するとデバッグしやすいよ！
        .map_err(|e| format!("履歴の保存に失敗しました: {}", e))
}

// --- Public functions to be called by lib.rs commands ---
// `async` と `#[tauri::command]` を削除し、通常の関数に変更
pub fn load_search_history(app_handle: &AppHandle<Wry>) -> Result<Vec<String>, String> {
    load_history_internal(app_handle, SEARCH_HISTORY_FILENAME)
}

pub fn save_search_history(
    app_handle: &AppHandle<Wry>,
    history: Vec<String>,
) -> Result<(), String> {
    save_history_internal(app_handle, SEARCH_HISTORY_FILENAME, history)
}

pub fn load_run_history(app_handle: &AppHandle<Wry>) -> Result<Vec<String>, String> {
    load_history_internal(app_handle, RUN_HISTORY_FILENAME)
}

pub fn save_run_history(
    app_handle: &AppHandle<Wry>,
    history: Vec<String>,
) -> Result<(), String> {
    save_history_internal(app_handle, RUN_HISTORY_FILENAME, history)
}