/**
 * リスト表示・スクロール制御まわりのロジックをまとめたモジュールだよ！
 * ここではスクロール時のデータ取得や、リスト・ウィンドウ高さの計算などを担当するよ。
 *
 * 使い方：
 * - handleScrollDebounced: スクロールイベント時に呼び出してね！
 * - calcListAndWindowHeight: 高さ計算用の関数だよ。
 * - calcItemCount: itemCountの計算用関数！
 */
import { INITIAL_ITEMS_TO_LOAD, RENDER_BUFFER_ITEMS, SCROLL_DEBOUNCE_MS, baseHeight, itemHeight, messageLineHeight, maxHeight } from './constants';

/**
 * スクロールイベントのデバウンス付きハンドラを返すよ！
 */
export function createScrollHandler({
  isLoadingMoreRef,
  totalResultsCountFromRustRef,
  itemHeightRef,
  itemsToRenderInViewRef,
  visibleStartIndexRef,
  visibleItemsRef,
  fetchItems,
}: {
  isLoadingMoreRef: () => boolean;
  totalResultsCountFromRustRef: () => number;
  itemHeightRef: () => number;
  itemsToRenderInViewRef: () => number;
  visibleStartIndexRef: () => number;
  visibleItemsRef: () => any[];
  fetchItems: (start: number, count: number) => void;
}) {
  let scrollTimeout: number;
  return function handleScroll(event: Event) {
    if (isLoadingMoreRef()) return;
    const target = event.target as HTMLElement;
    const scrollTop = target.scrollTop;
    const clientHeight = target.clientHeight;
    clearTimeout(scrollTimeout);
    scrollTimeout = window.setTimeout(() => {
      const totalResultsCountFromRust = totalResultsCountFromRustRef();
      if (totalResultsCountFromRust === 0) return;
      const itemHeight = itemHeightRef();
      const itemsToRenderInView = itemsToRenderInViewRef();
      const visibleStartIndex = visibleStartIndexRef();
      const visibleItems = visibleItemsRef();
      const middleVisibleGlobalIndex = Math.floor((scrollTop + clientHeight / 2) / itemHeight);
      const windowItemCount = (itemsToRenderInView > 0 ? itemsToRenderInView : INITIAL_ITEMS_TO_LOAD) + RENDER_BUFFER_ITEMS * 2;
      let newFetchStartIndex = Math.max(0, middleVisibleGlobalIndex - Math.floor(windowItemCount / 2));
      newFetchStartIndex = Math.min(newFetchStartIndex, Math.max(0, totalResultsCountFromRust - windowItemCount));
      newFetchStartIndex = Math.max(0, newFetchStartIndex);
      if (newFetchStartIndex === visibleStartIndex && visibleItems.length > 0) return;
      const changeThreshold = Math.max(1, Math.floor((itemsToRenderInView > 0 ? itemsToRenderInView : INITIAL_ITEMS_TO_LOAD) / 4));
      if (Math.abs(newFetchStartIndex - visibleStartIndex) < changeThreshold && visibleItems.length > 0) return;
      fetchItems(newFetchStartIndex, windowItemCount);
    }, SCROLL_DEBOUNCE_MS);
  };
}

/**
 * リストとウィンドウの高さを計算する関数だよ！
 * Svelteのリアクティブブロックから呼び出してね。
 */
export function calcListAndWindowHeight({
  message,
  itemCount,
  overflowMessageText,
  settingsApplied,
  currentWindowWidth,
  PhysicalSize,
  WebviewWindow,
  setListVisibleHeight,
}: {
  message: string;
  itemCount: number;
  overflowMessageText: string;
  settingsApplied: boolean;
  currentWindowWidth: number | undefined;
  PhysicalSize: any;
  WebviewWindow: any;
  setListVisibleHeight: (h: number) => void;
}) {
  let currentTotalHeight = baseHeight;
  let actualMessageHeight = 0;
  if (message) {
    const messageLines = message.split('\n').length; // メッセージの行数を数えるよ
    actualMessageHeight += messageLineHeight * messageLines; // 行数分の高さを確保！
  }
  let itemsSectionTargetHeight = 0;
  if (itemCount > 0) {
    itemsSectionTargetHeight = itemCount * itemHeight;
    if (overflowMessageText) actualMessageHeight += messageLineHeight;
  }
  currentTotalHeight += actualMessageHeight + itemsSectionTargetHeight;
  const finalWindowHeight = Math.min(Math.max(currentTotalHeight, baseHeight), maxHeight);
  if (itemCount > 0) {
    let nonListHeight = baseHeight;
    if (message && !message.includes("見つからなかった")) nonListHeight += messageLineHeight;
    if (overflowMessageText) nonListHeight += messageLineHeight;
    let availableHeightForList = finalWindowHeight - nonListHeight;
    setListVisibleHeight(Math.max(0, Math.min(itemsSectionTargetHeight, availableHeightForList)));
  } else {
    setListVisibleHeight(0);
  }
  if (typeof window !== 'undefined' && currentWindowWidth !== undefined && settingsApplied) {
    const currentAppWindow = WebviewWindow.getCurrent();
    currentAppWindow.setSize(new PhysicalSize(currentWindowWidth, finalWindowHeight)).catch(() => {});
  }
}

/**
 * itemCountの計算用関数！
 */
export function calcItemCount(totalResultsCountFromRust: number, displayLimit: number) {
  return displayLimit === -1 ? totalResultsCountFromRust : Math.min(totalResultsCountFromRust, displayLimit);
}
