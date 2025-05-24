import { invoke } from '@tauri-apps/api/core';
import type { SearchResultSlice } from './types';

/**
 * 指定範囲の検索アイテムをRustから取得する関数
 * @param startIndex 取得開始インデックス
 * @param count 取得件数
 * @returns 検索結果スライス
 */
export async function fetchItemsFromRust(startIndex: number, count: number): Promise<SearchResultSlice> {
  const actualStartIndex = Math.max(0, startIndex);
  const actualCount = Math.max(1, count);
  return await invoke<SearchResultSlice>('get_search_results_slice', {
    startIndex: actualStartIndex,
    count: actualCount
  });
}

/**
 * 検索キーワードでRustに検索を依頼する関数
 * @param keyword 検索キーワード
 * @param initialCount 最初に取得する件数
 * @returns 検索結果スライス
 */
export async function performSearch(keyword: string, initialCount: number): Promise<SearchResultSlice> {
  return await invoke<SearchResultSlice>('perform_search', {
    keyword,
    initialCount
  });
}

/**
 * ファイル/フォルダのアイコンタイプをRustから取得する関数
 * @param filePath ファイルパス
 * @returns 'file' | 'folder' | null
 */
export async function getIconType(filePath: string): Promise<'file' | 'folder' | null> {
  const cleanedPath = filePath.replace(/^file:/, '');
  return await invoke<string | null>('get_icon_for_path', { filePath: cleanedPath }) as 'file' | 'folder' | null;
}

export {};
