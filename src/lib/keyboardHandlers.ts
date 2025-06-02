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
      // selectedIndex が -1 になる場合でも、ensureSelectedItemVisibleAndFocusedFn 内の tick() が
      // Svelte側のフォーカス処理に良い影響を与えるかもしれないので、呼び出しを戻すよ！
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
      // 上と同じ理由で、ensureSelectedItemVisibleAndFocusedFn の呼び出しを戻すよ！
      await ensureSelectedItemVisibleAndFocusedFn(true, true);
    } else if (event.key === 'Tab') {
      if (!event.shiftKey && selectedIndex === -1 && itemCount > 0) {
        event.preventDefault();
        setSelectedIndex(0);
        setJustFocusedByKeyEvent(true);
        await ensureSelectedItemVisibleAndFocusedFn(true, true);
      } else if (event.shiftKey && selectedIndex === 0) { // アイテム0でShift+Tabを押して入力欄に戻るケース
        event.preventDefault();
        setSelectedIndex(-1);
        setJustFocusedByKeyEvent(true);
        await ensureSelectedItemVisibleAndFocusedFn(true, true); // Shift+Tabで入力欄に戻るときも同様に！
      }
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (selectedIndex !== -1) { // アイテム選択中に左右キーで入力欄に戻るケース
        event.preventDefault();
        setSelectedIndex(-1);
        setJustFocusedByKeyEvent(true);
        await ensureSelectedItemVisibleAndFocusedFn(true, true); // 左右キーで入力欄に戻るときも！
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
  // ★★★ イベントの伝播をここでストップ！ ★★★
  // リストアイテムでキー操作を処理したら、そのイベントが親要素に伝わって
  // 意図しないキー処理 (例えば Page.svelte 側の handleKeydown) が
  // 実行されちゃうのを防ぐよ！
  // これで、selectedIndex が勝手に書き変わっちゃうのを阻止できるかも！
  event.stopPropagation();
  const maxSelectableIndex = itemCount - 1;
  
  // ArrowUp, ArrowDown, Tab のキーイベントを処理するよ
  if (event.key === 'ArrowUp') {
    event.preventDefault(); // まずデフォルトの動作を止める！
    if (selectedIndex === 0) { // もし選択中のアイテムがリストの先頭だったら…
      setSelectedIndex(-1); // 選択を解除して、入力欄にフォーカスを戻すようにするよ
      setJustFocusedByKeyEvent(true); // キーイベントでフォーカスが変わったことを記録
      return; // ★ selectedIndex を -1 にしたら、この関数の処理はここで終わり！Svelte側のフォーカス処理に任せるよ！
    } else {
      // 先頭じゃなければ、汎用的な handleKeydown に処理をお任せして、一つ上のアイテムに移動するよ
      await handleKeydown({
        event,
        itemCount,
        selectedIndex,
        setSelectedIndex,
        totalResultsCountFromRust,
        visibleItems,
        visibleStartIndex,
        getItemByGlobalIndexFn,
        handleSearch: () => {}, // リストアイテム上でのEnterは検索じゃないから空関数
        executeResult,
        ensureSelectedItemVisibleAndFocusedFn,
        justFocusedByKeyEvent,
        setJustFocusedByKeyEvent
      });
    }
  } else if (event.key === 'ArrowDown' || event.key === 'Tab') {
    // ArrowDown と Tab は、これまで通り handleKeydown に処理を委譲するよ
    await handleKeydown({
      event,
      itemCount,
      selectedIndex,
      setSelectedIndex,
      // ... 他の引数も同様に渡すよ
      totalResultsCountFromRust, visibleItems, visibleStartIndex, getItemByGlobalIndexFn, handleSearch: () => {}, executeResult, ensureSelectedItemVisibleAndFocusedFn, justFocusedByKeyEvent, setJustFocusedByKeyEvent
    });
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault(); // デフォルト動作を止める
    setSelectedIndex(-1);
    setJustFocusedByKeyEvent(true);
    return; // ★ selectedIndex を -1 にしたら、この関数の処理はここで終わり！Svelte側のフォーカス処理に任せるよ！
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
