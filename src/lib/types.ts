// 型定義まとめたよ！(๑˃̵ᴗ˂̵)
export interface SearchResult {
  name: string;
  path: string;
  iconType?: 'file' | 'folder' | null;
}

export interface WindowSettings {
  width?: number;
  x?: number;
  y?: number;
  opacity?: number;
  displayLimit?: number;
}

export interface SearchResultSlice {
  items: SearchResult[];
  total_count: number;
}
