import { PhysicalPosition } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';
import type { WindowSettings } from './types';
import {
  DEFAULT_WINDOW_OPACITY,
  DEFAULT_WINDOW_BACKGROUND_COLOR,
  DEFAULT_MAX_HISTORY_COUNT, // ← 追加！
  SETTINGS_KEY_MAX_SEARCH_HISTORY // ← 追加！
} from './constants'; // デフォルト値をインポート！

/**
 * ウィンドウの初期設定を反映する関数
 * @param settings ウィンドウ設定
 * @returns Promise<void>
 */
export async function applyInitialSettings(settings: WindowSettings | null, setState: (key: string, value: any) => void): Promise<void> {
  const currentAppWindow = WebviewWindow.getCurrent();
  const promises: Promise<any>[] = [];

  // Svelte側の状態を更新していくよ！
  // settings が null や undefined でも、デフォルト値で初期化するイメージだね。
  const width = settings?.width; // settings が null の場合も考慮
  const x = settings?.x;
  const y = settings?.y;
  const opacity = settings?.opacity ?? DEFAULT_WINDOW_OPACITY; // opacity がなければデフォルト値
  const displayLimit = settings?.displayLimit ?? -1; // displayLimit がなければ -1 (無制限)
  const backgroundColor = settings?.backgroundColor ?? DEFAULT_WINDOW_BACKGROUND_COLOR; // backgroundColor がなければデフォルト値

  setState('currentOpacity', Math.round(opacity * 100)); // 0-100に変換してSvelte側で管理
  setState('displayLimit', displayLimit);
  setState('currentBackgroundColor', backgroundColor);

  if (settings) {
    if (width !== undefined) {
      setState('currentWindowWidth', width);
      // 幅の初期設定はTauri側が前回終了時の値を覚えてくれていることが多いので、
      // ここで明示的にsetSizeを呼ぶかは状況によるけど、状態だけ更新しておくね。
    }
    if (x !== undefined && y !== undefined) {
      setState('currentWindowX', x);
      setState('currentWindowY', y);
      promises.push(currentAppWindow.setPosition(new PhysicalPosition(x, y))); // 位置はAPIで設定！
    }
  }

  // もし設定に幅がなかったら、現在のウィンドウ幅を取得してSvelteの状態を更新するよ
  if (width === undefined) {
    promises.push(currentAppWindow.innerSize().then(size => setState('currentWindowWidth', size.width)));
  }

  setState(
    'maxHistoryCount', // ← page.svelte側の変数名に合わせる
    settings?.[SETTINGS_KEY_MAX_SEARCH_HISTORY] ?? DEFAULT_MAX_HISTORY_COUNT
  );
  await Promise.all(promises);
}

/**
 * Rustからウィンドウ設定を読み込む関数
 */
export async function loadWindowSettings(): Promise<WindowSettings> {
  return await invoke<WindowSettings>('load_window_settings');
}

/**
 * Rustへウィンドウ設定を保存する関数
 * settings オブジェクトには、保存したい項目だけ含めて渡してね！
 */
export async function saveWindowSettings(settings: WindowSettings): Promise<void> {
  await invoke('save_window_settings', { settings });
}

export {};
