mod searcher;

use anyhow::anyhow;
use tauri::{menu::{Menu, MenuItem}, App, AppHandle, Emitter, Manager, Result, Wry}; use tauri_plugin_global_shortcut::{ShortcutState};
// GlobalShortcutManager を追加したよ！
use tauri_plugin_log::{Target, TargetKind};
use std::sync::{Arc, Mutex}; // AppStateをmanageするために追加！
use std::fs;
use std::path::PathBuf;

const SETTINGS_FILE_NAME: &str = "seeku-settings.json";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // searcherモジュールからAppStateをuseするよ！
  use searcher::AppState;
  let app_state = Arc::new(Mutex::new(AppState::default()));
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .targets([Target::new(TargetKind::Stdout), Target::new(TargetKind::Webview)])
            .build(),
        )?;
      }
      create_menu(app)?;
      Ok(())
    })
    .manage(app_state) // ← AppStateをTauriくんに管理してもらう！
    .invoke_handler(tauri::generate_handler![
      load_window_settings,
      save_window_settings,
      // search_files, // ← 古いコマンドはお役御免！
      open_path,
      open_path_as_admin,
      searcher::perform_search,
      searcher::get_search_results_slice,
      searcher::get_icon_for_path
    ])
    // メニューで何かイベントがあったら…
    .on_menu_event(|app, event| {
      // どのメニューが押されたのかな～？
      match event.id().as_ref() {
        "quit" => {
          app.exit(0);
        }
        _ => {} // 他のは今は何もしなーい
      }
    })
    .plugin(tauri_plugin_fs::init())
    .plugin(
      tauri_plugin_global_shortcut::Builder::new()
          .with_shortcuts(["ctrl+alt+space"]).unwrap()
          .with_handler(|app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
              let _ = app.emit("toggle-window", "triggered");
            }
          })
          .build()
    )
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn create_menu(app: &mut App) -> Result<()> {
  let quit_i =
    MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&quit_i])?;

  app.tray_by_id("seeku").unwrap().set_menu(Some(menu))?;
  Ok(()) // ちゃんと成功したよーって教えてあげる！
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Default, Clone)]
struct WindowSettings {
  width: Option<u32>,
  x: Option<i32>,
  y: Option<i32>,
  opacity: Option<f64>,
}

fn get_settings_path(app_handle: &AppHandle<Wry>) -> Result<PathBuf> {
  let mut path = app_handle.path().app_config_dir()?;
  if !path.exists() {
    fs::create_dir_all(&path)?;
  }
  path.push(SETTINGS_FILE_NAME);
  Ok(path)
}

// この関数は内部で使うようにして、tauri::commandからは直接呼ばないようにするね！
fn load_window_settings_internal(app_handle: &AppHandle<Wry>) -> Result<WindowSettings> {
  let path = get_settings_path(&app_handle)?;
  if path.exists() {
    let content = fs::read_to_string(path)?;
    let settings: WindowSettings = serde_json::from_str(&content)?;
    Ok(settings)
  } else {
    Ok(WindowSettings::default()) // 設定ファイルがなかったらデフォルト値を返すよ！
  }
}

#[tauri::command]
fn load_window_settings(app_handle: AppHandle<Wry>) -> Result<WindowSettings> {
  load_window_settings_internal(&app_handle)
}

#[tauri::command]
fn save_window_settings(app_handle: AppHandle<Wry>, settings: WindowSettings) -> Result<()> {
  let path = get_settings_path(&app_handle)?;
  let content = serde_json::to_string_pretty(&settings)?;
  fs::write(path, content)?;
  Ok(())
}

#[tauri::command]
fn open_path(path: String) -> Result<()> {
  use std::process::Command;
  Command::new("cmd")
    .args(&["/C", "start", "", &path])
    .spawn()
    .map_err(|e| tauri::Error::Anyhow(anyhow!(e.to_string())))?;
  Ok(())
}

#[tauri::command]
fn open_path_as_admin(path: String) -> Result<()> {
  use std::process::Command;
  let _ = Command::new("powershell")
    .args(&[
      "-Command",
      &format!("Start-Process -FilePath \"{}\" -Verb RunAs", path.replace("\"", "\\\"")) // パス中のダブルクォートをエスケープするよ！
    ])
    .output()
    .map_err(|e| format!("PowerShellの実行に失敗しちゃった… (´；ω；｀): {}", e));
  Ok(())
}
