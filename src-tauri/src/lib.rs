mod searcher;

use tauri::{menu::{Menu, MenuItem}, App, AppHandle, Manager, Result, Wry};
use tauri_plugin_log::{Target, TargetKind};
use std::fs;
use std::path::PathBuf;

const SETTINGS_FILE_NAME: &str = "seeku-settings.json";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
    .invoke_handler(tauri::generate_handler![
      load_window_settings,
      save_window_settings,
      search_files
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
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn create_menu(app: &mut App) -> Result<()> {
  // AppHandle を使ってメニューアイテムを作るんだ！ (｡•̀ω-)b
  let app_handle = app.handle();
  let quit_i =
    MenuItem::with_id(app_handle, "quit", "Quit", true, None::<&str>)?;
  let menu = Menu::with_items(app_handle, &[&quit_i])?;

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
fn search_files(app_handle: AppHandle<Wry>, term: String) -> Result<Vec<searcher::SearchItem>> {
  searcher::search_with_powershell(&app_handle, &term)
    .map_err(|e_str| tauri::Error::AssetNotFound(e_str))
}
