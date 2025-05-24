// キーボード操作＆選択インデックス制御のロジックをまとめたよ！(๑˃̵ᴗ˂̵)و
// Svelteの状態更新はコールバックで渡してね！
import { tick } from 'svelte';
import { invoke } from '@tauri-apps/api/core';
import type { SearchResult } from './types';
import {
  INITIAL_ITEMS_TO_LOAD,
  RENDER_BUFFER_ITEMS,
  FOCUS_RETRY_LIMIT,
  itemHeight
} from './constants';

/**
 * visibleItemsの中から、グローバルインデックスでアイテムを取得するヘルパー
 */
export function getItemByGlobalIndex(globalIndex: number, visibleStartIndex: number, visibleItems: SearchResult[]): SearchResult | undefined {
  if (globalIndex >= visibleStartIndex && globalIndex < visibleStartIndex + visibleItems.length) {
    return visibleItems[globalIndex - visibleStartIndex];
  }
  return undefined;
}

/**
 * 選択されたアイテムが表示範囲内にあるか確認し、必要ならデータを読み込んでフォーカス＆スクロールする関数！
 * Svelteの状態更新やfetchItemsは引数で渡してね！
 */
export async function ensureSelectedItemVisibleAndFocused({
  selectedIndex,
  visibleStartIndex,
  visibleItems,
  totalResultsCountFromRust,
  itemsToRenderInView,
  fetchItems,
  setSelectedIndex,
  tickFn = tick,
  isTriggeredByKeyEvent = false,
  resetKeyEventFlag = false,
  RENDER_BUFFER_ITEMS,
  INITIAL_ITEMS_TO_LOAD,
  FOCUS_RETRY_LIMIT,
  itemHeight,
  justFocusedByKeyEvent,
  setJustFocusedByKeyEvent
}: {
  selectedIndex: number,
  visibleStartIndex: number,
  visibleItems: SearchResult[],
  totalResultsCountFromRust: number,
  itemsToRenderInView: number,
  fetchItems: (start: number, count: number) => Promise<void>,
  setSelectedIndex: (idx: number) => void,
  tickFn?: typeof tick,
  isTriggeredByKeyEvent?: boolean,
  resetKeyEventFlag?: boolean,
  RENDER_BUFFER_ITEMS: number,
  INITIAL_ITEMS_TO_LOAD: number,
  FOCUS_RETRY_LIMIT: number,
  itemHeight: number,
  justFocusedByKeyEvent: boolean,
  setJustFocusedByKeyEvent: (v: boolean) => void
}) {
  await tickFn();
  if (selectedIndex === -1) {
    // input欄にフォーカスはSvelte側でやってね！
    return;
  }
  const currentItem = getItemByGlobalIndex(selectedIndex, visibleStartIndex, visibleItems);
  if (currentItem) {
    await focusAndScrollToSelectedItem({ selectedIndex, visibleStartIndex, visibleItems, itemHeight, FOCUS_RETRY_LIMIT, RENDER_BUFFER_ITEMS, isTriggeredByKeyEvent });
  } else {
    const windowItemCount = (itemsToRenderInView > 0 ? itemsToRenderInView : INITIAL_ITEMS_TO_LOAD) + RENDER_BUFFER_ITEMS * 2;
    let newFetchStartIndex = Math.max(0, selectedIndex - Math.floor(windowItemCount / 2));
    newFetchStartIndex = Math.min(newFetchStartIndex, Math.max(0, totalResultsCountFromRust - windowItemCount));
    newFetchStartIndex = Math.max(0, newFetchStartIndex);
    await fetchItems(newFetchStartIndex, windowItemCount);
    await tickFn();
    await focusAndScrollToSelectedItem({ selectedIndex, visibleStartIndex: newFetchStartIndex, visibleItems, itemHeight, FOCUS_RETRY_LIMIT, RENDER_BUFFER_ITEMS, isTriggeredByKeyEvent });
  }
  if (isTriggeredByKeyEvent && resetKeyEventFlag) {
    setJustFocusedByKeyEvent(false);
  }
}

/**
 * 実際にフォーカスとスクロールを行う関数
 */
export async function focusAndScrollToSelectedItem({
  selectedIndex,
  visibleStartIndex,
  visibleItems,
  itemHeight,
  FOCUS_RETRY_LIMIT,
  RENDER_BUFFER_ITEMS,
  isTriggeredByKeyEvent = false
}: {
  selectedIndex: number,
  visibleStartIndex: number,
  visibleItems: SearchResult[],
  itemHeight: number,
  FOCUS_RETRY_LIMIT: number,
  RENDER_BUFFER_ITEMS: number,
  isTriggeredByKeyEvent?: boolean
}) {
  const resultsContainer = document.querySelector('.results-list-scroll-container') as HTMLElement | null;
  await new Promise(resolve => requestAnimationFrame(resolve));
  if (selectedIndex === -1) return;
  const localIndex = selectedIndex - visibleStartIndex;
  const scrollTopBeforeFocusLogic = resultsContainer ? resultsContainer.scrollTop : 0;
  if (resultsContainer && localIndex >= 0 && localIndex < visibleItems.length) {
    for (let i = 0; i < FOCUS_RETRY_LIMIT; i++) {
      await tick();
      await new Promise(requestAnimationFrame);
      const targetElement = resultsContainer.querySelector(`div[data-index="${selectedIndex}"]`) as HTMLElement | null;
      if (targetElement) {
        targetElement.focus();
        if (resultsContainer && resultsContainer.scrollTop !== scrollTopBeforeFocusLogic) {
          resultsContainer.scrollTop = scrollTopBeforeFocusLogic;
        }
        if (isTriggeredByKeyEvent && resultsContainer) {
          const initialScrollTop = resultsContainer.scrollTop;
          const containerRect = resultsContainer.getBoundingClientRect();
          const targetRect = targetElement.getBoundingClientRect();
          let newScrollTop = initialScrollTop;
          const bufferPx = RENDER_BUFFER_ITEMS * itemHeight / 4;
          if (targetRect.bottom < containerRect.top) {
            newScrollTop = targetElement.offsetTop - bufferPx;
          } else if (targetRect.top > containerRect.bottom) {
            newScrollTop = (targetElement.offsetTop + itemHeight) - resultsContainer.clientHeight + bufferPx;
          } else if (targetRect.top < containerRect.top) {
            newScrollTop = initialScrollTop - (containerRect.top - targetRect.top);
          } else if (targetRect.bottom > containerRect.bottom) {
            newScrollTop = initialScrollTop + (targetRect.bottom - containerRect.bottom);
          }
          const maxScroll = resultsContainer.scrollHeight - resultsContainer.clientHeight;
          newScrollTop = Math.max(0, Math.min(newScrollTop, maxScroll < 0 ? 0 : maxScroll));
          if (initialScrollTop.toFixed(0) !== newScrollTop.toFixed(0)) {
            resultsContainer.scrollTop = newScrollTop;
          }
        }
        return;
      }
    }
    if (resultsContainer && resultsContainer.scrollTop !== scrollTopBeforeFocusLogic) {
      resultsContainer.scrollTop = scrollTopBeforeFocusLogic;
    }
  }
}

/**
 * 検索欄・リストアイテムのkeydownハンドラ
 * Svelteの状態更新や副作用はコールバックで渡してね！
 */
export async function handleKeydown({
  event,
  itemCount,
  selectedIndex,
  setSelectedIndex,
  totalResultsCountFromRust,
  visibleItems,
  visibleStartIndex,
  getItemByGlobalIndexFn,
  handleSearch,
  executeResult,
  ensureSelectedItemVisibleAndFocusedFn,
  justFocusedByKeyEvent,
  setJustFocusedByKeyEvent
}: {
  event: KeyboardEvent,
  itemCount: number,
  selectedIndex: number,
  setSelectedIndex: (idx: number) => void,
  totalResultsCountFromRust: number,
  visibleItems: SearchResult[],
  visibleStartIndex: number,
  getItemByGlobalIndexFn: (globalIndex: number) => SearchResult | undefined,
  handleSearch: () => void,
  executeResult: (item: SearchResult) => void,
  ensureSelectedItemVisibleAndFocusedFn: (isTriggeredByKeyEvent: boolean, resetKeyEventFlag: boolean) => Promise<void>,
  justFocusedByKeyEvent: boolean,
  setJustFocusedByKeyEvent: (v: boolean) => void
}) {
  const maxSelectableIndex = itemCount - 1;
  if (itemCount > 0) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (selectedIndex < maxSelectableIndex) {
        setSelectedIndex(selectedIndex + 1);
      } else {
        setSelectedIndex(-1);
      }
      setJustFocusedByKeyEvent(true);
      await ensureSelectedItemVisibleAndFocusedFn(true, true);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (selectedIndex === -1 && itemCount > 0) {
        setSelectedIndex(maxSelectableIndex);
      } else if (selectedIndex > 0) {
        setSelectedIndex(selectedIndex - 1);
      } else {
        setSelectedIndex(-1);
      }
      setJustFocusedByKeyEvent(true);
      await ensureSelectedItemVisibleAndFocusedFn(true, true);
    } else if (event.key === 'Tab') {
      if (!event.shiftKey && selectedIndex === -1 && itemCount > 0) {
        event.preventDefault();
        setSelectedIndex(0);
        setJustFocusedByKeyEvent(true);
        await ensureSelectedItemVisibleAndFocusedFn(true, true);
      } else if (event.shiftKey && selectedIndex === 0) {
        event.preventDefault();
        setSelectedIndex(-1);
        setJustFocusedByKeyEvent(true);
        await ensureSelectedItemVisibleAndFocusedFn(true, true);
      }
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (selectedIndex !== -1) {
        event.preventDefault();
        setSelectedIndex(-1);
        setJustFocusedByKeyEvent(true);
        await ensureSelectedItemVisibleAndFocusedFn(true, true);
      }
    } else if (event.key === 'Enter') {
      if (selectedIndex >= 0 && selectedIndex < totalResultsCountFromRust && visibleItems.length > 0) {
        const itemToExecute = getItemByGlobalIndexFn(selectedIndex);
        if (itemToExecute) {
          if (event.ctrlKey) {
            invoke('open_path_as_admin', { path: itemToExecute.path })
              .catch(err => console.error('管理者権限での実行に失敗しちゃった… (´；ω；｀)', err));
          } else {
            executeResult(itemToExecute);
          }
        }
      } else {
        handleSearch();
      }
    }
  } else if (event.key === 'Enter') {
    handleSearch();
  }
}

/**
 * リストアイテム用のkeydownハンドラ
 */
export async function handleResultKeydown({
  event,
  idx,
  itemCount,
  selectedIndex,
  setSelectedIndex,
  totalResultsCountFromRust,
  visibleItems,
  visibleStartIndex,
  getItemByGlobalIndexFn,
  executeResult,
  ensureSelectedItemVisibleAndFocusedFn,
  justFocusedByKeyEvent,
  setJustFocusedByKeyEvent
}: {
  event: KeyboardEvent,
  idx: number,
  itemCount: number,
  selectedIndex: number,
  setSelectedIndex: (idx: number) => void,
  totalResultsCountFromRust: number,
  visibleItems: SearchResult[],
  visibleStartIndex: number,
  getItemByGlobalIndexFn: (globalIndex: number) => SearchResult | undefined,
  executeResult: (item: SearchResult) => void,
  ensureSelectedItemVisibleAndFocusedFn: (isTriggeredByKeyEvent: boolean, resetKeyEventFlag: boolean) => Promise<void>,
  justFocusedByKeyEvent: boolean,
  setJustFocusedByKeyEvent: (v: boolean) => void
}) {
  const maxSelectableIndex = itemCount - 1;
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Tab') {
    await handleKeydown({
      event,
      itemCount,
      selectedIndex,
      setSelectedIndex,
      totalResultsCountFromRust,
      visibleItems,
      visibleStartIndex,
      getItemByGlobalIndexFn,
      handleSearch: () => {},
      executeResult,
      ensureSelectedItemVisibleAndFocusedFn,
      justFocusedByKeyEvent,
      setJustFocusedByKeyEvent
    });
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    setSelectedIndex(-1);
    setJustFocusedByKeyEvent(true);
    await ensureSelectedItemVisibleAndFocusedFn(true, true);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    if (selectedIndex !== maxSelectableIndex) {
      setSelectedIndex(maxSelectableIndex);
      setJustFocusedByKeyEvent(true);
      await ensureSelectedItemVisibleAndFocusedFn(true, true);
    }
  } else if (event.key === 'Enter') {
    const globalIdx = visibleStartIndex + idx;
    if (globalIdx >= 0 && globalIdx < totalResultsCountFromRust) {
      const itemToExecute = getItemByGlobalIndexFn(globalIdx);
      if (itemToExecute) {
        if (event.ctrlKey) {
          invoke('open_path_as_admin', { path: itemToExecute.path })
            .catch(err => console.error('管理者権限での実行に失敗しちゃった… (´；ω；｀)', err));
        } else {
          executeResult(itemToExecute);
        }
      }
    }
  }
}

// これでキーボード系のロジックはここに集約！
// (っ´ω`c)
