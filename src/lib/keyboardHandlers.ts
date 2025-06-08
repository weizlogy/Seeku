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
  setJustFocusedByKeyEvent,
  resultsContainerElement // ★★★ 引数デストラクチャリングに resultsContainerElement を追加！ ★★★
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
  setJustFocusedByKeyEvent: (v: boolean) => void,
  resultsContainerElement: HTMLElement | null // ★★★ スクロールコンテナ要素を受け取る！ ★★★
}) {
  await tickFn();
  if (selectedIndex === -1) {
    // input欄にフォーカスはSvelte側でやってね！
    return;
  }
  const currentItem = getItemByGlobalIndex(selectedIndex, visibleStartIndex, visibleItems);
  if (currentItem) {
    await focusAndScrollToSelectedItem({ selectedIndex, visibleStartIndex, visibleItems, itemHeight, FOCUS_RETRY_LIMIT, RENDER_BUFFER_ITEMS, isTriggeredByKeyEvent, resultsContainer: resultsContainerElement });
  } else {
    const windowItemCount = (itemsToRenderInView > 0 ? itemsToRenderInView : INITIAL_ITEMS_TO_LOAD) + RENDER_BUFFER_ITEMS * 2;
    let newFetchStartIndex = Math.max(0, selectedIndex - Math.floor(windowItemCount / 2));
    newFetchStartIndex = Math.min(newFetchStartIndex, Math.max(0, totalResultsCountFromRust - windowItemCount));
    newFetchStartIndex = Math.max(0, newFetchStartIndex);
    await fetchItems(newFetchStartIndex, windowItemCount);
    await tickFn();
    await focusAndScrollToSelectedItem({ selectedIndex, visibleStartIndex: newFetchStartIndex, visibleItems, itemHeight, FOCUS_RETRY_LIMIT, RENDER_BUFFER_ITEMS, isTriggeredByKeyEvent, resultsContainer: resultsContainerElement });
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
  isTriggeredByKeyEvent = false,
  resultsContainer: resultsContainerFromSvelte // ★★★ Svelteから渡されたコンテナ要素を使うよ！ ★★★
}: {
  selectedIndex: number,
  visibleStartIndex: number,
  visibleItems: SearchResult[],
  itemHeight: number,
  FOCUS_RETRY_LIMIT: number,
  RENDER_BUFFER_ITEMS: number,
  isTriggeredByKeyEvent?: boolean,
  resultsContainer: HTMLElement | null // ★★★ 型定義も更新！ ★★★
}) {
  const resultsContainer = resultsContainerFromSvelte; // ★★★ document.querySelector の代わりに引数を使う！ ★★★
  await new Promise(resolve => requestAnimationFrame(resolve));
  if (selectedIndex === -1) {
    return;
  }
  const localIndex = selectedIndex - visibleStartIndex;
  // console.log(`[ScrollDebug]   localIndex: ${localIndex} (selectedIndex: ${selectedIndex}, visibleStartIndex: ${visibleStartIndex})`);
  // const scrollTopBeforeFocusLogic = resultsContainer ? resultsContainer.scrollTop : 0; // 意図しないスクロールを防ぐためだったが、キー操作のスクロールを阻害する可能性があるので一旦コメントアウト
  if (resultsContainer && localIndex >= 0 && localIndex < visibleItems.length) {
    // console.log(`[ScrollDebug]   resultsContainer IS VALID and localIndex IS IN RANGE.`);
    for (let i = 0; i < FOCUS_RETRY_LIMIT; i++) {
      await tick();
      await new Promise(requestAnimationFrame);
      const targetElement = resultsContainer.querySelector(`div[data-index="${selectedIndex}"]`) as HTMLElement | null;
      if (targetElement) {
        targetElement.focus({ preventScroll: true }); // ★ ブラウザの自動スクロールを抑制！
        if (isTriggeredByKeyEvent && resultsContainer) {
          const scrollTop = resultsContainer.scrollTop; // 現在のスクロール位置
          const containerHeight = resultsContainer.clientHeight; // コンテナの表示高さ
          const itemOffsetTop = targetElement.offsetTop; // アイテムのコンテナ内でのY位置
          const itemHeightActual = targetElement.offsetHeight; // アイテムの実際の高さ (itemHeight定数より正確かも)

          const buffer = 5; // スクロールした後に、アイテムの上下に欲しい小さな余白 (ピクセル)

          let newScrollTop = scrollTop; // 新しいスクロール位置の候補

          // 1. アイテムがコンテナの上端より上にはみ出しているか、または上端に近すぎる場合
          if (itemOffsetTop < scrollTop + buffer) {
            newScrollTop = itemOffsetTop - buffer;
          }
          // 2. アイテムがコンテナの下端より下にはみ出しているか、または下端に近すぎる場合
          //    (else if にしないと、アイテムがコンテナより大きい場合に両方trueになってしまうかも)
          else if (itemOffsetTop + itemHeightActual > scrollTop + containerHeight - buffer) {
            newScrollTop = itemOffsetTop + itemHeightActual - containerHeight + buffer;
          }

          // スクロール位置を0以上に、かつ最大スクロール可能量以下に制限するよ
          const maxScroll = resultsContainer.scrollHeight - containerHeight;
          const finalNewScrollTop = Math.max(0, Math.min(newScrollTop, maxScroll < 0 ? 0 : maxScroll)); // maxScrollがマイナスなら0

          if (Math.abs(scrollTop - finalNewScrollTop) > 0.5) { // わずかな差でも更新するように (toFixed(0)だと整数しか見ないからね)
            resultsContainer.scrollTop = finalNewScrollTop;
          }
        }
        return;
      }
    }
  } else {
  }
}
// ★★★ ここから新しいモード別ハンドラ関数たち！ ★★★

export interface RunHistoryModeKeydownContext {
  runHistory: string[];
  selectedRunHistoryIndex: number;
  setSelectedRunHistoryIndex: (index: number) => void;
  executeAndExitRunHistoryMode: (itemPath: string) => Promise<void>;
  setIsRunHistoryModeActive: (isActive: boolean) => void;
  focusSearchInput: () => void;
  // searchTerm: string; // 文字入力でモード解除するために必要なら追加
}

export async function handleRunHistoryModeKeydown(event: KeyboardEvent, context: RunHistoryModeKeydownContext) {
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    context.setSelectedRunHistoryIndex(Math.max(0, context.selectedRunHistoryIndex - 1));
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    context.setSelectedRunHistoryIndex(Math.min(context.runHistory.length - 1, context.selectedRunHistoryIndex + 1));
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (context.selectedRunHistoryIndex >= 0 && context.selectedRunHistoryIndex < context.runHistory.length) {
      await context.executeAndExitRunHistoryMode(context.runHistory[context.selectedRunHistoryIndex]);
    }
  } else if (event.key === 'Escape') {
    event.preventDefault();
    context.setIsRunHistoryModeActive(false);
    context.setSelectedRunHistoryIndex(-1);
    context.focusSearchInput();
  } else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
    context.setIsRunHistoryModeActive(false);
    context.setSelectedRunHistoryIndex(-1);
    context.focusSearchInput();
    // この後の通常検索モードの処理にイベントを渡すため、ここでは event.stopPropagation() しない
  } else {
    // 上記以外のキーは実行履歴モード中は無視
    event.stopPropagation(); // 他のハンドラに影響しないように
  }
}

export interface HelpModeKeydownContext {
  helpScrollTransformY: number;
  setHelpScrollTransformY: (y: number) => void;
  HELP_LINE_HEIGHT_PX: number;
  messageAreaElementRef: HTMLElement | null;
  helpInnerContentElementRef: HTMLElement | null;
  setIsHelpModeActive: (isActive: boolean) => void;
  setHelpContentText: (text: string) => void;
  focusSearchInput: () => void;
  // ウィンドウサイズ復元のためのコールバックも必要なら追加
  restoreWindowHeightBeforeHelp?: () => Promise<void>;
  setSelectedIndex: (idx: number) => void;
}

export async function handleHelpModeKeydown(event: KeyboardEvent, context: HelpModeKeydownContext) {
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    context.setHelpScrollTransformY(Math.min(0, context.helpScrollTransformY + context.HELP_LINE_HEIGHT_PX));
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (context.messageAreaElementRef && context.helpInnerContentElementRef) {
      const contentActualHeight = context.helpInnerContentElementRef.offsetHeight;
      const containerVisibleHeight = context.messageAreaElementRef.clientHeight;
      const maxScrollDownNegative = Math.min(0, containerVisibleHeight - contentActualHeight);
      context.setHelpScrollTransformY(Math.max(maxScrollDownNegative, context.helpScrollTransformY - context.HELP_LINE_HEIGHT_PX));
    }
  } else if (event.key === 'Escape') {
    event.preventDefault();
    context.setIsHelpModeActive(false);
    context.setHelpContentText('');
    context.setHelpScrollTransformY(0);
    if (context.restoreWindowHeightBeforeHelp) await context.restoreWindowHeightBeforeHelp();
    await tick();
    context.focusSearchInput();
  } else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
    context.setIsHelpModeActive(false);
    context.setHelpContentText('');
    context.setHelpScrollTransformY(0);
    if (context.restoreWindowHeightBeforeHelp) await context.restoreWindowHeightBeforeHelp();
    context.setSelectedIndex(-1);
    context.focusSearchInput();
    // この後の通常検索モードの処理にイベントを渡すため、ここでは event.stopPropagation() しない
  } else {
    event.stopPropagation(); // 他のハンドラに影響しないように
  }
}

export interface SearchHistoryBrowseKeydownContext {
  searchHistory: string[];
  currentHistoryIndex: number;
  setCurrentHistoryIndex: (index: number) => void;
  userInputBeforeHistoryBrowse: string | null;
  setUserInputBeforeHistoryBrowse: (term: string | null) => void;
  setSearchTerm: (term: string) => void;
  focusAndSelectSearchInput: () => void;
}

export async function handleSearchHistoryBrowseKeydown(event: KeyboardEvent, context: SearchHistoryBrowseKeydownContext) {
  if (context.searchHistory.length === 0) return;

  if (context.currentHistoryIndex === -1 && context.userInputBeforeHistoryBrowse === null) {
    // 履歴ブラウズ開始前に現在の入力内容を保存 (Svelte側で searchTerm を直接参照する形でも良い)
    // context.setUserInputBeforeHistoryBrowse(currentSearchTerm); // Svelte側で管理
  }

  let newHistoryIndex = context.currentHistoryIndex;
  if (event.key === 'ArrowUp') {
    if (newHistoryIndex === -1) newHistoryIndex = 0;
    else newHistoryIndex = (newHistoryIndex - 1 + context.searchHistory.length) % context.searchHistory.length;
  } else { // ArrowDown
    if (newHistoryIndex === -1) newHistoryIndex = context.searchHistory.length - 1;
    else newHistoryIndex = (newHistoryIndex + 1) % context.searchHistory.length;
  }
  context.setCurrentHistoryIndex(newHistoryIndex);
  context.setSearchTerm(context.searchHistory[newHistoryIndex]);
  await tick();
  context.focusAndSelectSearchInput();
}

export interface NormalSearchKeydownContext {
  event: KeyboardEvent,
  itemCount: number,
  selectedIndex: number,
  navigateAndFocus: (newIndex: number) => Promise<void>, // selectedIndexの更新とフォーカス/スクロール
  totalResultsCountFromRust: number,
  visibleItems: SearchResult[],
  visibleStartIndex: number,
  getItemByGlobalIndexFn: (globalIndex: number) => SearchResult | undefined,
  handleSearch: () => void,
  executeResult: (item: SearchResult) => void,
}

export async function handleNormalSearchKeydown(context: NormalSearchKeydownContext) {
  const {
    event,
    itemCount,
    selectedIndex,
    navigateAndFocus,
    totalResultsCountFromRust,
    visibleItems,
    getItemByGlobalIndexFn,
    handleSearch,
    executeResult,
  } = context;

  const maxSelectableIndex = itemCount - 1;

  if (itemCount > 0) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (selectedIndex < maxSelectableIndex) {
        await navigateAndFocus(selectedIndex + 1);
      } else {
        await navigateAndFocus(-1);
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (selectedIndex === -1 && itemCount > 0) {
        await navigateAndFocus(maxSelectableIndex);
      } else if (selectedIndex > 0) {
        await navigateAndFocus(selectedIndex - 1);
      } else {
        await navigateAndFocus(-1);
      }
    } else if (event.key === 'Tab') {
      if (!event.shiftKey && selectedIndex === -1 && itemCount > 0) {
        event.preventDefault();
        await navigateAndFocus(0);
      } else if (event.shiftKey && selectedIndex === 0) {
        event.preventDefault();
        await navigateAndFocus(-1);
      }
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (selectedIndex !== -1) {
        event.preventDefault();
        await navigateAndFocus(-1);
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

export interface ResultItemKeydownContext {
  event: KeyboardEvent;
  localIndex: number; // このアイテムのvisibleItems内でのインデックス
  itemCount: number;
  selectedIndex: number;
  // setSelectedIndex: (idx: number) => void; // navigateAndFocus に統合
  totalResultsCountFromRust: number;
  visibleItems: SearchResult[];
  visibleStartIndex: number;
  getItemByGlobalIndexFn: (globalIndex: number) => SearchResult | undefined;
  executeResult: (item: SearchResult) => void;
  // ensureSelectedItemVisibleAndFocusedFn: (isTriggeredByKeyEvent: boolean, resetKeyEventFlag: boolean) => Promise<void>;
  // justFocusedByKeyEvent: boolean; // navigateAndFocus内で処理
  // setJustFocusedByKeyEvent: (v: boolean) => void; // navigateAndFocus内で処理
  navigateAndFocus: (newIndex: number) => Promise<void>;
}

export async function handleResultItemKeydown(context: ResultItemKeydownContext) {
  const {
    event,
    localIndex,
    itemCount,
    totalResultsCountFromRust,
    visibleStartIndex,
    getItemByGlobalIndexFn,
    executeResult,
    navigateAndFocus,
  } = context;

  event.stopPropagation();
  const maxSelectableIndex = itemCount - 1;
  const globalCurrentIndex = visibleStartIndex + localIndex;

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (globalCurrentIndex === 0) {
      await navigateAndFocus(-1);
    } else {
      await navigateAndFocus(globalCurrentIndex - 1);
    }
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (globalCurrentIndex < maxSelectableIndex) {
      await navigateAndFocus(globalCurrentIndex + 1);
    }
  } else if (event.key === 'Tab') {
    if (event.shiftKey && globalCurrentIndex === 0) {
      event.preventDefault();
      await navigateAndFocus(-1);
    }
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    await navigateAndFocus(-1);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    await navigateAndFocus(-1);
  } else if (event.key === 'Enter') {
    if (globalCurrentIndex >= 0 && globalCurrentIndex < totalResultsCountFromRust) {
      const itemToExecute = getItemByGlobalIndexFn(globalCurrentIndex);
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

/**
 * リストアイテム用のkeydownハンドラ
 */
export async function handleResultKeydown({
  event,
  idx,
  itemCount,
  // selectedIndex, // handleResultItemKeydown には selectedIndex は直接渡さない（navigateAndFocus経由で処理）
  // setSelectedIndex, // handleResultItemKeydown は navigateAndFocus を使うので不要
  totalResultsCountFromRust,
  visibleItems,
  visibleStartIndex,
  getItemByGlobalIndexFn,
  executeResult,
  // ensureSelectedItemVisibleAndFocusedFn, // navigateAndFocus に統合
  // justFocusedByKeyEvent, // navigateAndFocus で処理
  // setJustFocusedByKeyEvent, // navigateAndFocus で処理
  navigateAndFocus // ★★★ これを渡すように変更！ ★★★
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
  navigateAndFocus: (newIndex: number) => Promise<void> // ★★★ 型定義も更新！ ★★★
}) {
  // 新しい handleResultItemKeydown を呼び出すよ！
  // 必要な情報を context オブジェクトにまとめて渡すイメージだね。
  await handleResultItemKeydown({
    event,
    localIndex: idx,
    itemCount,
    selectedIndex: -1, // handleResultItemKeydown は selectedIndex を直接使わないのでダミー値を渡すか、型定義から削除してもOK
    totalResultsCountFromRust,
    visibleItems,
    visibleStartIndex,
    getItemByGlobalIndexFn,
    executeResult,
    navigateAndFocus,
  });
}

// これでキーボード系のロジックはここに集約！
// (っ´ω`c)
