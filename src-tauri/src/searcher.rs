use std::process::Command;
use tauri::{AppHandle, Manager, Wry};
use std::path::PathBuf;
use std::sync::{Arc, Mutex}; // AppStateで使うから追加！

// Svelte側と型名を合わせるために SearchItem -> SearchResult に変更！
// Clone と Deserialize も追加しておくと後々便利かも！
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct SearchResult {
  name: String,
  path: String,
}

// アプリケーション全体で共有する状態だよ！
#[derive(Default)] // .default() で初期化できるようにするおまじない！
pub struct AppState {
  search_results: Vec<SearchResult>, // ここに全検索結果を保存！
  total_results_count: usize,      // 全体の件数も覚えとく！
}

#[derive(serde::Serialize, Clone)] // Svelteに返すデータの形
pub struct SearchResultSlice {
  items: Vec<SearchResult>,
  total_count: usize,
}

fn get_script_path(app_handle: &AppHandle<Wry>) -> Result<PathBuf, String> {
  let resource_dir = app_handle
    .path()
    .resource_dir()
    .expect("リソースディレクトリが見つからなかったにゃん… (´・ω・｀)");

  let script_path = resource_dir.join("powershell").join("search.ps1");

  if script_path.exists() {
    Ok(script_path)
  } else {
    Err(format!(
      "PowerShellスクリプトがリソースに見つからなかったみたい… Path: {:?}",
      script_path
    ))
  }
}

// この関数は perform_search から呼ばれる内部関数になるので、pubじゃなくてもOK！
// 返り値の型も SearchResult に変更するよ！
fn search_with_powershell_internal(app_handle: &AppHandle<Wry>, query: &str) -> Result<Vec<SearchResult>, String> {
    let ps_script = get_script_path(app_handle)?;
    let ps_script_str = ps_script.to_str().ok_or_else(|| {
        format!("PowerShellスクリプトのパスが変だよ！ Path: {:?}", ps_script)
    })?;

    let output =
      Command::new("powershell")
        .args(&["-ExecutionPolicy", "Bypass", "-File", ps_script_str, "-query", query])
        .output()
        .map_err(|e| format!("PowerShellの実行に失敗しちゃった… (´；ω；｀): {}", e))?;

    if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr);
      return Err(format!(
        "PowerShellスクリプトがエラーを返したみたい… Status: {}, Stderr: {}",
        output.status,
        stderr
      ));
    }

    // PowerShellくんのお話がUTF-8じゃなくても、優しく受け止めてあげるよ！ (<em>´ω｀</em>)
    let json_string = String::from_utf8_lossy(&output.stdout).into_owned();

    if json_string.trim().is_empty() {
        // PowerShellから何も返ってこなかったら、空っぽのリストを返すね！
        return Ok(Vec::new());
    }

    // まず配列としてパースを試みる。ダメなら単一オブジェクトとしてラップ！
    let parsed_values: Vec<serde_json::Value> = match serde_json::from_str(&json_string) {
        Ok(v) => v,
        Err(_) => {
            let single: serde_json::Value = serde_json::from_str(&json_string)
                .map_err(|e| format!("JSONのパースに失敗しちゃった… (´・ω・｀): {}, JSON: {}", e, json_string))?;
            vec![single]
        }
    };
    
    let results = parsed_values.iter().filter_map(|item_value| {
      // ここも SearchResult に変更！
      Some(SearchResult {
        name: item_value.get("Name")?.as_str()?.to_string(),
        path: item_value.get("Path")?.as_str()?.to_string()
      })
    }).collect();
    Ok(results)
}

// Tauriコマンド: 検索を実行して、最初のN件と総件数を返すよ！
#[tauri::command]
pub async fn perform_search(
    app_handle: AppHandle<Wry>, // AppHandle を受け取るように変更！
    keyword: String,
    initial_count: usize,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<SearchResultSlice, String> {
    if keyword.trim().is_empty() {
        let mut app_state = state.lock().unwrap();
        app_state.search_results = Vec::new();
        app_state.total_results_count = 0;
        return Ok(SearchResultSlice {
            items: Vec::new(),
            total_count: 0,
        });
    }

    // search_with_powershell_internal を呼び出すよ！
    let all_found_results = search_with_powershell_internal(&app_handle, &keyword)?;

    let total_count = all_found_results.len();
    let items_to_return = all_found_results.iter().take(initial_count).cloned().collect();

    let mut app_state = state.lock().unwrap();
    app_state.search_results = all_found_results;
    app_state.total_results_count = total_count;

    Ok(SearchResultSlice {
        items: items_to_return,
        total_count,
    })
}

// Tauriコマンド: 指定された範囲の検索結果を返すよ！
#[tauri::command]
pub async fn get_search_results_slice(
    start_index: usize,
    count: usize,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<SearchResultSlice, String> {
    let app_state = state.lock().unwrap();
    let end_index = (start_index + count).min(app_state.total_results_count);
    let items_slice = if start_index >= app_state.total_results_count { Vec::new() } else { app_state.search_results[start_index..end_index].to_vec() };
    Ok(SearchResultSlice { items: items_slice, total_count: app_state.total_results_count })
}
