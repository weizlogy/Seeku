<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { PhysicalSize, PhysicalPosition } from '@tauri-apps/api/window';
  import { invoke } from '@tauri-apps/api/core';
  import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { listen } from '@tauri-apps/api/event';
  import FileIcon from '$lib/icons/fileicon.svelte';
  import FolderIcon from '$lib/icons/foldericon.svelte';
  import type { SearchResult } from '$lib/types';
  import {
    itemHeight,
    INITIAL_ITEMS_TO_LOAD,
    RENDER_BUFFER_ITEMS,
    FOCUS_RETRY_LIMIT,
    DEFAULT_WINDOW_WIDTH,
    DEFAULT_WINDOW_OPACITY
  } from '$lib/constants';
  import { fetchItemsFromRust, performSearch, getIconType } from '$lib/searchLogic';
  import { applyInitialSettings, loadWindowSettings, saveWindowSettings } from '$lib/windowLogic';
  import { createScrollHandler, calcListAndWindowHeight, calcItemCount } from '$lib/listViewLogic';
  import { ensureSelectedItemVisibleAndFocused, getItemByGlobalIndex } from '$lib/keyboardHandlers';
  import styles from './+page.module.css';

  let searchInput: HTMLInputElement; // input要素を後でつかまえるためのおてて！
  let searchTerm: string = '';
  let message: string = '';

  let visibleItems: SearchResult[] = []; // 今、画面に見えてる範囲のアイテムたち！ ✨
  let visibleStartIndex: number = 0;     // visibleItems が、全体の何番目から始まってるか！

  let displayLimit: number = -1; // デフォルトは無制限！
  let totalResultsCountFromRust: number = 0; // Rustセンパイが教えてくれた総検索結果数！
  let overflowMessageText = ''; // 上限を超えたときに出すメッセージ！

  // -1はinput欄、0～は候補リストのインデックス！
  // selectedIndex は、全体のインデックスを指すようにするよ！
  // (visibleItemsの中のインデックスじゃないから注意！)
  let selectedIndex: number = -1;

  let currentWindowWidth: number | undefined = undefined;
  let currentWindowX: number | undefined = undefined;
  let currentWindowY: number | undefined = undefined;
  let currentOpacity: number = 1.0; // ウィンドウの透明度だよ！最初はくっきり！

  let settingsApplied = false; // 設定が適用されたかな？ (<em>´ω｀</em>)
  let initialSettingsError: string | null = null; // 設定読み込みでエラーが出ちゃった？
  let listVisibleHeight: number = 0; // リスト表示エリアの実際の高さ！ (CSSピクセル)
  
  let isLoadingMore = false; // 追加のアイテムを読み込み中かな？フラグ！
  let justFocusedByKeyEvent = false; // キーイベントでフォーカスした直後かな？フラグ！ ✨

  /**
 * 検索キーワードで検索し、結果を表示する
 */
async function handleSearch() {
  message = '';
  if (searchTerm.trim() === '') {
    message = '何か入力してね！ (｡•́︿•̀｡)';
    visibleItems = [];
    visibleStartIndex = 0;
    selectedIndex = -1;
    totalResultsCountFromRust = 0;
    return;
  }
  try {
    isLoadingMore = true;
    const countToLoad = itemsToRenderInView > 0 ? itemsToRenderInView + RENDER_BUFFER_ITEMS * 2 : INITIAL_ITEMS_TO_LOAD;
    const slice = await performSearch(searchTerm, countToLoad);
    visibleItems = slice.items;
    visibleStartIndex = 0;
    totalResultsCountFromRust = slice.total_count;
    for (const item of visibleItems) {
      fetchAndSetIconType(item.path);
    }
    selectedIndex = visibleItems.length > 0 ? 0 : -1;
    if (totalResultsCountFromRust === 0) {
      message = `「${searchTerm}」は見つからなかったよ… (´・ω・｀)`;
    }
  } catch (error) {
    console.error('Search failed:', error);
    let userFriendlyMessage = `検索中にエラーが起きちゃったみたい… (´；ω；｀)\nもう一度試してみてね。`;
    if (String(error).includes('invalid type: map, expected a sequence')) {
      userFriendlyMessage = `検索結果のデータの形がちょっとおかしかったみたいで、うまく表示できなかったの… (｡>﹏<｡)\nもしかしたら、1件だけ見つかったときにこの問題が起きるのかも？\nもし何度も起きるようなら、アプリの開発者さんにこのことを伝えてみてね！`;
    }
    message = userFriendlyMessage;
    visibleItems = [];
    visibleStartIndex = 0;
    selectedIndex = -1;
    totalResultsCountFromRust = 0;
  } finally {
    isLoadingMore = false;
  }
  // 検索結果の数に応じてオーバーフローメッセージを更新
  if (displayLimit !== -1 && totalResultsCountFromRust > displayLimit) {
    overflowMessageText = `他にも ${totalResultsCountFromRust - displayLimit} 件あるよ！ もっと絞り込んでね！ (ゝ∀･)⌒☆`;
  } else {
    overflowMessageText = '';
  }
  // スクロール位置もリセット
  const listContainer = document.querySelector('.results-list-scroll-container');
  if (listContainer) listContainer.scrollTop = 0;
}

/**
 * 指定範囲のアイテムを取得して表示する
 */
async function fetchItems(startIndex: number, count: number) {
  if (isLoadingMore) return;
  isLoadingMore = true;
  try {
    const slice = await fetchItemsFromRust(startIndex, count);
    if (slice.items.length > 0) {
      visibleItems = slice.items;
      visibleStartIndex = Math.max(0, startIndex);
      for (const item of visibleItems) {
        fetchAndSetIconType(item.path);
      }
    }
    totalResultsCountFromRust = slice.total_count;
  } catch (error) {
    console.error('アイテムの読み込みに失敗しちゃった… (´；ω；｀)', error);
  } finally {
    isLoadingMore = false;
  }
}

/**
 * アイコンタイプを取得してvisibleItemsにセットする
 */
async function fetchAndSetIconType(itemPath: string) {
  const currentItem = visibleItems.find(i => i.path === itemPath);
  if (currentItem && currentItem.iconType === undefined) {
    try {
      const type = await getIconType(itemPath);
      const itemToUpdate = visibleItems.find(i => i.path === itemPath);
      if (itemToUpdate) {
        if (type === 'file' || type === 'folder') {
          itemToUpdate.iconType = type;
        } else {
          itemToUpdate.iconType = null;
        }
        visibleItems = [...visibleItems];
      }
    } catch (error) {
      console.warn(`アイコンタイプの取得に失敗 (path: ${itemPath}):`, error);
      const itemToUpdateOnError = visibleItems.find(i => i.path === itemPath);
      if (itemToUpdateOnError) {
        itemToUpdateOnError.iconType = null;
        visibleItems = [...visibleItems];
      }
    }
  }
}

// --- ウィンドウ設定の初期化・保存・読込はwindowLogic.tsの関数を使う形に整理済み ---

  // listVisibleHeight が変わったら、一度に描画するアイテム数を再計算！
  $: if (listVisibleHeight > 0 && itemHeight > 0) {
    itemsToRenderInView = Math.ceil(listVisibleHeight / itemHeight);
    // console.log(`リスト表示高さ: ${listVisibleHeight}px, 1アイテム高さ: ${itemHeight}px => 描画アイテム数: ${itemsToRenderInView}`);
    // 必要ならここで最初のアイテム群を再取得してもいいかも？
  }


  async function handleKeydown(event: KeyboardEvent) { // async を追加！
    // 選択できる最大indexはitemCount-1だよ！
    const maxSelectableIndex = itemCount - 1;
    if (itemCount > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (selectedIndex < maxSelectableIndex) {
          selectedIndex++;
        } else {
          selectedIndex = -1;
        }
        // tick().then(focusCurrent); // focusCurrent の中でスクロールも考慮するので、呼び出し方を少し変えるかも
        justFocusedByKeyEvent = true; // キーで選択したよ！ってフラグを立てる！
        await ensureSelectedItemVisibleAndFocused({
          selectedIndex,
          visibleStartIndex,
          visibleItems,
          totalResultsCountFromRust,
          itemsToRenderInView,
          fetchItems,
          setSelectedIndex: (idx) => { selectedIndex = idx; },
          tickFn: tick,
          isTriggeredByKeyEvent: true,
          resetKeyEventFlag: true,
          RENDER_BUFFER_ITEMS,
          INITIAL_ITEMS_TO_LOAD,
          FOCUS_RETRY_LIMIT,
          itemHeight,
          justFocusedByKeyEvent,
          setJustFocusedByKeyEvent: (v) => { justFocusedByKeyEvent = v; }
        });
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (selectedIndex === -1 && itemCount > 0) {
          selectedIndex = maxSelectableIndex;
        } else if (selectedIndex > 0) {
          selectedIndex--;
        } else {
          selectedIndex = -1;
        }
        // tick().then(focusCurrent);
        justFocusedByKeyEvent = true;
        await ensureSelectedItemVisibleAndFocused({
          selectedIndex,
          visibleStartIndex,
          visibleItems,
          totalResultsCountFromRust,
          itemsToRenderInView,
          fetchItems,
          setSelectedIndex: (idx) => { selectedIndex = idx; },
          tickFn: tick,
          isTriggeredByKeyEvent: true,
          resetKeyEventFlag: true,
          RENDER_BUFFER_ITEMS,
          INITIAL_ITEMS_TO_LOAD,
          FOCUS_RETRY_LIMIT,
          itemHeight,
          justFocusedByKeyEvent,
          setJustFocusedByKeyEvent: (v) => { justFocusedByKeyEvent = v; }
        });
      } else if (event.key === 'Tab') {
        if (!event.shiftKey && selectedIndex === -1 && itemCount > 0) {
          event.preventDefault();
          selectedIndex = 0;
          // tick().then(focusCurrent);
          justFocusedByKeyEvent = true;
          await ensureSelectedItemVisibleAndFocused({
            selectedIndex,
            visibleStartIndex,
            visibleItems,
            totalResultsCountFromRust,
            itemsToRenderInView,
            fetchItems,
            setSelectedIndex: (idx) => { selectedIndex = idx; },
            tickFn: tick,
            isTriggeredByKeyEvent: true,
            resetKeyEventFlag: true,
            RENDER_BUFFER_ITEMS,
            INITIAL_ITEMS_TO_LOAD,
            FOCUS_RETRY_LIMIT,
            itemHeight,
            justFocusedByKeyEvent,
            setJustFocusedByKeyEvent: (v) => { justFocusedByKeyEvent = v; }
          });
        } else if (event.shiftKey && selectedIndex === 0) {
          event.preventDefault();
          selectedIndex = -1;
          // tick().then(focusCurrent);
          justFocusedByKeyEvent = true;
          await ensureSelectedItemVisibleAndFocused({
            selectedIndex,
            visibleStartIndex,
            visibleItems,
            totalResultsCountFromRust,
            itemsToRenderInView,
            fetchItems,
            setSelectedIndex: (idx) => { selectedIndex = idx; },
            tickFn: tick,
            isTriggeredByKeyEvent: true,
            resetKeyEventFlag: true,
            RENDER_BUFFER_ITEMS,
            INITIAL_ITEMS_TO_LOAD,
            FOCUS_RETRY_LIMIT,
            itemHeight,
            justFocusedByKeyEvent,
            setJustFocusedByKeyEvent: (v) => { justFocusedByKeyEvent = v; }
          });
        }
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        // リストアイテムが選択されている場合のみ、←→でinput欄に戻る！
        if (selectedIndex !== -1) {
          event.preventDefault();
          selectedIndex = -1;
          // tick().then(focusCurrent);
          justFocusedByKeyEvent = true;
          await ensureSelectedItemVisibleAndFocused({
            selectedIndex,
            visibleStartIndex,
            visibleItems,
            totalResultsCountFromRust,
            itemsToRenderInView,
            fetchItems,
            setSelectedIndex: (idx) => { selectedIndex = idx; },
            tickFn: tick,
            isTriggeredByKeyEvent: true,
            resetKeyEventFlag: true,
            RENDER_BUFFER_ITEMS,
            INITIAL_ITEMS_TO_LOAD,
            FOCUS_RETRY_LIMIT,
            itemHeight,
            justFocusedByKeyEvent,
            setJustFocusedByKeyEvent: (v) => { justFocusedByKeyEvent = v; }
          });
        }
      } else if (event.key === 'Enter') {
        if (selectedIndex >= 0 && selectedIndex < totalResultsCountFromRust && visibleItems.length > 0) {
          const itemToExecute = getItemByGlobalIndex(selectedIndex, visibleStartIndex, visibleItems);
          if (itemToExecute) {
            if (event.ctrlKey) {
              // Ctrl + Enter の場合は管理者権限で実行！
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

  // handleResultKeydown も同様に置き換え
  async function handleResultKeydown(event: KeyboardEvent, idx: number) {
    const maxSelectableIndex = itemCount - 1;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Tab') {
      await handleKeydown(event);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      selectedIndex = -1;
      justFocusedByKeyEvent = true;
      await ensureSelectedItemVisibleAndFocused({
        selectedIndex,
        visibleStartIndex,
        visibleItems,
        totalResultsCountFromRust,
        itemsToRenderInView,
        fetchItems,
        setSelectedIndex: (idx) => { selectedIndex = idx; },
        tickFn: tick,
        isTriggeredByKeyEvent: true,
        resetKeyEventFlag: true,
        RENDER_BUFFER_ITEMS,
        INITIAL_ITEMS_TO_LOAD,
        FOCUS_RETRY_LIMIT,
        itemHeight,
        justFocusedByKeyEvent,
        setJustFocusedByKeyEvent: (v) => { justFocusedByKeyEvent = v; }
      });
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (selectedIndex !== maxSelectableIndex) {
        selectedIndex = maxSelectableIndex;
        justFocusedByKeyEvent = true;
        await ensureSelectedItemVisibleAndFocused({
          selectedIndex,
          visibleStartIndex,
          visibleItems,
          totalResultsCountFromRust,
          itemsToRenderInView,
          fetchItems,
          setSelectedIndex: (idx) => { selectedIndex = idx; },
          tickFn: tick,
          isTriggeredByKeyEvent: true,
          resetKeyEventFlag: true,
          RENDER_BUFFER_ITEMS,
          INITIAL_ITEMS_TO_LOAD,
          FOCUS_RETRY_LIMIT,
          itemHeight,
          justFocusedByKeyEvent,
          setJustFocusedByKeyEvent: (v) => { justFocusedByKeyEvent = v; }
        });
      }
    } else if (event.key === 'Enter') {
      const globalIdx = visibleStartIndex + idx;
      if (globalIdx >= 0 && globalIdx < totalResultsCountFromRust) {
        const itemToExecute = getItemByGlobalIndex(globalIdx, visibleStartIndex, visibleItems);
        if (itemToExecute) {
          if (event.ctrlKey) {
            // Ctrl + Enter の場合は管理者権限で実行！
            invoke('open_path_as_admin', { path: itemToExecute.path })
              .catch(err => console.error('管理者権限での実行に失敗しちゃった… (´；ω；｀)', err));
          } else {
            executeResult(itemToExecute);
          }
        }
      }
    }
  }

  // ファイルやフォルダを実行する処理（Windows用: startコマンドで開く）
  function executeResult(result: SearchResult) {
    if (!result) return;
    // ファイルパスを取得
    const path = result.path;
    // Tauri経由でOSのコマンドを実行する（invokeでRust側に投げるのが安全！）
    invoke('open_path', { path })
      .then(() => {
        console.log('ファイル/フォルダを開いたよ！', path);
      })
      .catch((err) => {
        console.error('ファイル/フォルダの実行に失敗しちゃった…', err);
      });
  }

  // ページがぴょこって表示されたら、キー入力の準備をするよ！
  onMount(() => {
    let unlistenResizedFn: (() => void) | undefined;
    let unlistenMovedFn: (() => void) | undefined;
    let unlistenToggleWindowFn: (() => void) | undefined;

    // windowLogicの関数で状態を更新するためのコールバック
    const setState = (key: string, value: any) => {
      if (key === 'currentWindowWidth') currentWindowWidth = value;
      if (key === 'currentWindowX') currentWindowX = value;
      if (key === 'currentWindowY') currentWindowY = value;
      if (key === 'currentOpacity') currentOpacity = value;
      if (key === 'displayLimit') displayLimit = value;
    };

    // 設定を読み込んで反映
    loadWindowSettings()
      .then(async settings => {
        console.log('やったー！設定が届いたよ！ ☆:.｡. o(≧▽≦)o .｡.☆', settings);
        await applyInitialSettings(settings, setState);
        initialSettingsError = null;
      })
      .catch(async err => {
        console.error('うにゃ～ん、設定読み込みでエラーだって… (´；ω；｀)', err);
        initialSettingsError = String(err);
        await applyInitialSettings({ width: DEFAULT_WINDOW_WIDTH, opacity: DEFAULT_WINDOW_OPACITY }, setState);
      })
      .finally(async () => {
        settingsApplied = true;
        const currentAppWindow = WebviewWindow.getCurrent();
        await currentAppWindow.show().then(() => {
          currentAppWindow.isVisible().then(visible => {});
          currentAppWindow.setFocus();
        }).catch(() => {});
      });

    const currentAppWindow = WebviewWindow.getCurrent();
    currentAppWindow.outerPosition().then(pos => {
      // console.log('Initial window outer position:', pos);
    });
    currentAppWindow.innerSize().then(size => {
      // console.log('Initial window inner size:', size);
    });
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.target !== searchInput && event.key.length === 1
          && !event.ctrlKey && !event.altKey && !event.metaKey) {
        searchInput.focus(); // 検索欄に注目！(๑•̀ㅁ•́๑)✧
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);

    const handleMouseDown = (event: MouseEvent) => {
      if (event.ctrlKey) {
        WebviewWindow.getCurrent().startDragging();
      }
    };
    window.addEventListener('mousedown', handleMouseDown);

    // Ctrl + ホイールで透明度を変える魔法だよ！ (∩^o^)⊃━☆ﾟ.*･｡
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
        const deltaY = event.deltaY > 0 ? -0.05 : 0.05;
        let newOpacity = Math.max(0.1, Math.min(1.0, currentOpacity + deltaY));
        newOpacity = parseFloat(newOpacity.toFixed(2));
        currentOpacity = newOpacity;
        saveWindowSettings({ width: currentWindowWidth, x: currentWindowX, y: currentWindowY, opacity: currentOpacity });
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    
    currentAppWindow.onResized(({ payload: size }) => {
      currentWindowWidth = size.width;
      saveWindowSettings({ width: currentWindowWidth, x: currentWindowX, y: currentWindowY, opacity: currentOpacity });
    }).then(unlistener => {
      unlistenResizedFn = unlistener;
    });

    currentAppWindow.onMoved(({ payload: position }) => {
      currentWindowX = position.x;
      currentWindowY = position.y;
      saveWindowSettings({ width: currentWindowWidth, x: currentWindowX, y: currentWindowY, opacity: currentOpacity });
    }).then(unlistener => {
      unlistenMovedFn = unlistener;
    });

    // --- ホットキーイベントのリスナーを登録！ ---
    // Rust側から 'toggle-window' イベントが来たら、ウィンドウの表示/非表示を切り替えるよ！
    listen<null>('toggle-window', async () => {
      console.log('ホットキーイベント "toggle-window" を受信したよ！');
      const currentAppWindow = WebviewWindow.getCurrent();
      const isVisible = await currentAppWindow.isVisible();
      if (isVisible) {
        await currentAppWindow.hide();
      } else {
        await currentAppWindow.show();
        await currentAppWindow.setFocus(); // 表示したらフォーカスも当てる！
        if (searchInput) {
          searchInput.focus(); // 検索欄にもフォーカス！ (๑•̀ㅂ•́)و✧
        }
      }
    }).then(unlistener => {
      unlistenToggleWindowFn = unlistener; // 解除関数を保存！
    });

    return () => { // コンポーネントが消えるときに、イベントリスナーもちゃんとお片付け！偉い！ (<em>´ω｀</em>)
      window.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('wheel', handleWheel);
      if (unlistenResizedFn) unlistenResizedFn();
      if (unlistenMovedFn) unlistenMovedFn();
      if (unlistenToggleWindowFn) unlistenToggleWindowFn(); // ← 忘れずにお片付け！
    };
  });

  // --- 高さ調整のリアクティブブロック ---
  $: calcListAndWindowHeight({
  message,
  itemCount,
  overflowMessageText,
  settingsApplied,
  currentWindowWidth,
  PhysicalSize,
  WebviewWindow,
  setListVisibleHeight: (h) => { listVisibleHeight = h; }
});

// itemCountはSvelteのリアクティブ変数として宣言！
$: itemCount = calcItemCount(totalResultsCountFromRust, displayLimit);

$: if (visibleItems.length === 0 && totalResultsCountFromRust === 0) selectedIndex = -1;

let itemsToRenderInView = 0; // 実際に一度に画面に描画するアイテムの数 (listVisibleHeight から計算)

// スクロールハンドラをlistViewLogicから生成！
const handleScroll = createScrollHandler({
  isLoadingMoreRef: () => isLoadingMore,
  totalResultsCountFromRustRef: () => totalResultsCountFromRust,
  itemHeightRef: () => itemHeight,
  itemsToRenderInViewRef: () => itemsToRenderInView,
  visibleStartIndexRef: () => visibleStartIndex,
  visibleItemsRef: () => visibleItems,
  fetchItems
});
</script>

<link href="https://fonts.googleapis.com/css2?family=M+PLUS+1+Code&display=swap" rel="stylesheet">

<main style="background-color: rgba(255, 255, 255, {currentOpacity});">
  <div class={styles['search-container']}>
    <input
      type="text"
      bind:value={searchTerm}
      bind:this={searchInput}
      on:keydown={handleKeydown}
      on:focus={() => { selectedIndex = -1; }}
      placeholder="検索キーワードを入力..."
      aria-label="検索キーワード"
      class={styles.input}
    />
  </div>

  {#if message}
    <p class={styles.message}>{message}</p>
  {/if}

  {#if totalResultsCountFromRust > 0}
    <div 
      class={styles['results-list-scroll-container']}
      style="height: {listVisibleHeight}px; overflow-y: auto;"
      on:scroll={handleScroll}
    >
      <div class={styles['results-list-content']} style="height: {totalResultsCountFromRust * itemHeight}px; position: relative;">
        {#each visibleItems as item, localIndex (item.path) }
          {@const globalIndex = visibleStartIndex + localIndex}
          <div
            aria-label={item.name}
            title={item.path}
            class:selected={selectedIndex === globalIndex}
            class={styles.item}
            role="option"
            aria-selected={selectedIndex === globalIndex ? 'true' : 'false'}
            on:keydown={(e) => handleResultKeydown(e, localIndex)}
            on:click={() => { selectedIndex = globalIndex; executeResult(item); }}
            data-index={globalIndex}
            tabindex={selectedIndex === globalIndex ? 0 : -1}
            style="position: absolute; top: {globalIndex * itemHeight}px; width: 100%;"
          >
            <div class={styles['item-icon-area']}>
              {#if item.iconType === 'file'}
                <FileIcon />
              {:else if item.iconType === 'folder'}
                <FolderIcon />
              {/if}
            </div>
            <div class={styles['item-text-area']}>
              <span class={styles['item-name']}>{item.name}</span>
              {#if item.path !== item.name}
                <span class={styles['item-path']} title={item.path}>{item.path.replace(/^file:/, '')}</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
    {#if selectedIndex >= 0 && totalResultsCountFromRust > 0 && visibleItems.length > 0}
      <p class={styles['position-info']}>
        ({selectedIndex + 1} / {totalResultsCountFromRust})
      </p>
    {/if}
    {#if overflowMessageText && totalResultsCountFromRust > displayLimit}
      <p class={styles['overflow-message']}>{overflowMessageText}</p>
    {/if}
  {/if}
</main>

<style src="./+page.module.css"></style>
