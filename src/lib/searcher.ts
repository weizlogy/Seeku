import { invoke } from '@tauri-apps/api/core';

export interface SearchResult {
  name: string;
  path: string;
}

export async function searchFiles(query: string): Promise<SearchResult[]> {
  const result = await invoke<SearchResult[]>('search_files', { term: query });
  return result;
}
