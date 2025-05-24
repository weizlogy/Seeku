import { PhysicalPosition } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';
import type { WindowSettings } from './types';

/**
 * ウィンドウの初期設定を反映する関数
 * @param settings ウィンドウ設定
 * @returns Promise<void>
 */
export async function applyInitialSettings(settings: WindowSettings | null, setState: (key: string, value: any) => void): Promise<void> {
  const currentAppWindow = WebviewWindow.getCurrent();
  const promises: Promise<any>[] = [];
  if (settings) {
    if (settings.width !== undefined) setState('currentWindowWidth', settings.width);
    if (settings.x !== undefined && settings.y !== undefined) {
      setState('currentWindowX', settings.x);
      setState('currentWindowY', settings.y);
      promises.push(currentAppWindow.setPosition(new PhysicalPosition(settings.x, settings.y)));
    }
    if (settings.opacity !== undefined) setState('currentOpacity', settings.opacity);
    if (settings.displayLimit !== undefined) setState('displayLimit', settings.displayLimit);
    else setState('displayLimit', -1);
  }
  if (settings?.width === undefined) {
    promises.push(currentAppWindow.innerSize().then(size => setState('currentWindowWidth', size.width)));
  }
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
 */
export async function saveWindowSettings(settings: WindowSettings): Promise<void> {
  await invoke('save_window_settings', { settings });
}

export {};
