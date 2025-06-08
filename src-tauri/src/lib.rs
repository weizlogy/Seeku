mod searcher;

use anyhow::anyhow;
use tauri::{menu::{Menu, MenuItem}, App, AppHandle, Emitter, Manager, Result, Wry}; use tauri_plugin_global_shortcut::{ShortcutState};
// GlobalShortcutManager を追加したよ！
use tauri_plugin_log::{Target, TargetKind};
use std::sync::{Arc, Mutex}; // AppStateをmanageするために追加！
use std::fs;
#[cfg(target_os = "windows")] // Windowsの時だけ使うおまじない！
use std::os::windows::process::CommandExt;
use std::path::PathBuf;

pub mod history_manager;

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
      searcher::get_icon_for_path,
      load_search_history_cmd,
      save_search_history_cmd,
      load_run_history_cmd,
      save_run_history_cmd
    ])
    // メニューで何かイベントがあったら…
    .on_menu_event(|app, event| {
      // どのメニューが押されたのかな～？
      // "main" ウィンドウがなかったら、ちょっと困っちゃうから先に言っておくね！
      let window = app.get_webview_window("main").unwrap();
      match event.id().as_ref() {
        "quit" => {
          app.exit(0);
        }
        "open" => {
          let _ = window.show();
          let _ = window.unminimize();
          let _ = window.set_focus();
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
  let open_i = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
  let quit_i =
    MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&open_i, &quit_i])?;

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
  let mut command = Command::new("cmd");
  command.args(&["/C", "start", "", &path]);

  // --- ここからが追加だよ！ ---
  // Windowsだったら、コマンド実行時に新しいウィンドウを開かないようにするおまじない！
  #[cfg(target_os = "windows")]
  command.creation_flags(0x08000000); // CREATE_NO_WINDOW
  // --- ここまでが追加だよ！ ---
  command.spawn()
    .map_err(|e| tauri::Error::Anyhow(anyhow!(e.to_string())))?;
  Ok(())
}

#[tauri::command]
fn open_path_as_admin(path: String) -> Result<()> {
  use std::process::Command;
  let mut command = Command::new("powershell");
  command.args(&[
      "-Command",
      &format!("Start-Process -FilePath \"{}\" -Verb RunAs", path.replace("\"", "\\\"")) // パス中のダブルクォートをエスケープするよ！
    ]);

  // --- ここからが追加だよ！ (管理者権限実行の時も念のため！) ---
  #[cfg(target_os = "windows")]
  command.creation_flags(0x08000000); // CREATE_NO_WINDOW
  // --- ここまでが追加だよ！ ---

  let _ = command.output() // .spawn() じゃなくて .output() を使ってるから、元々ウィンドウは出にくいけど、念のため！
    .map_err(|e| format!("PowerShellの実行に失敗しちゃった… (´；ω；｀): {}", e));
  Ok(())
}

// --- History Commands ---
// これらのコマンドは history_manager の関数を呼び出すラッパーになります。

// Changed return type to tauri::Result and map String error to tauri::Error
#[tauri::command]
fn load_search_history_cmd(app_handle: AppHandle<Wry>) -> tauri::Result<Vec<String>> {
    history_manager::load_search_history(&app_handle).map_err(|e| tauri::Error::Anyhow(anyhow!(e)))
}

#[tauri::command]
fn save_search_history_cmd(app_handle: AppHandle<Wry>, history: Vec<String>) -> tauri::Result<()> {
    history_manager::save_search_history(&app_handle, history).map_err(|e| tauri::Error::Anyhow(anyhow!(e)))
}

#[tauri::command]
fn load_run_history_cmd(app_handle: AppHandle<Wry>) -> tauri::Result<Vec<String>> {
    history_manager::load_run_history(&app_handle).map_err(|e| tauri::Error::Anyhow(anyhow!(e)))
}

#[tauri::command]
fn save_run_history_cmd(app_handle: AppHandle<Wry>, history: Vec<String>) -> tauri::Result<()> {
    history_manager::save_run_history(&app_handle, history).map_err(|e| tauri::Error::Anyhow(anyhow!(e)))
}
