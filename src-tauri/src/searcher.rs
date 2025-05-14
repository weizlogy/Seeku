use std::process::Command;
use tauri::{AppHandle, Manager, Wry};
use std::path::PathBuf;

#[derive(serde::Serialize)] // Svelteに送るために必要だよ！
pub struct SearchItem {
  name: String,
  path: String,
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

pub fn search_with_powershell(app_handle: &AppHandle<Wry>, query: &str) -> Result<Vec<SearchItem>, String> {
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

    let parsed_values: Vec<serde_json::Value> = serde_json::from_str(&json_string)
        .map_err(|e| format!("JSONのパースに失敗しちゃった… (´・ω・｀): {}, JSON: {}", e, json_string))?;
    
    let results = parsed_values.iter().filter_map(|item_value| {
      Some(SearchItem {
        name: item_value.get("Name")?.as_str()?.to_string(),
        path: item_value.get("Path")?.as_str()?.to_string()
      })
    }).collect();

    Ok(results)
}
