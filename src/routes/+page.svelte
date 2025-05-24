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
    DEFAULT_WINDOW_OPACITY,
    DEFAULT_WINDOW_BACKGROUND_COLOR
  } from '$lib/constants';
  import { fetchItemsFromRust, performSearch, getIconType } from '$lib/searchLogic';
  import { applyInitialSettings, loadWindowSettings, saveWindowSettings as saveWindowSettingsToRust } from '$lib/windowLogic';
  import { createScrollHandler, calcListAndWindowHeight, calcItemCount } from '$lib/listViewLogic';
  import { handleCommand as processCommand } from '$lib/commandHandler'; // ← コマンド処理をインポート！
  import { ensureSelectedItemVisibleAndFocused, getItemByGlobalIndex } from '$lib/keyboardHandlers';
  import styles from './+page.module.css';

  let searchInput: HTMLInputElement; // input要素を後でつかまえるためのおてて！
  let searchTerm: string = '';
  let message: string = '';
  // ★★★ ヘルプ擬似スクロール用のおててたち (既存のmessage欄を使う版！) ★★★
  let isHelpModeActive: boolean = false;    // ヘルプ表示中かどうかのフラグだよ！
  let helpContentText: string = '';         // 表示するヘルプのテキスト全部！
  let helpScrollTransformY: number = 0;     // ヘルプをどれだけY軸方向に動かすか！
  const HELP_LINE_HEIGHT_PX: number = 18;   // ヘルプ1行あたりの高さ（CSSのline-heightと合わせようね！）
  let previousWindowHeightBeforeHelp: number | undefined = undefined; // ヘルプモードに入る前のウィンドウの高さを記憶するおてて！
  let messageAreaElementRef: HTMLElement | null = null; // メッセージ表示エリアのDOM要素への参照！
  let helpInnerContentElementRef: HTMLElement | null = null; // ヘルプのインナーテキスト要素の参照！
  // ★★★ ここまで追加 ★★★

  let visibleItems: SearchResult[] = []; // 今、画面に見えてる範囲のアイテムたち！ ✨
  let visibleStartIndex: number = 0;     // visibleItems が、全体の何番目から始まってるか！

  let displayLimit: number = -1; // デフォルトは無制限！
  let totalResultsCountFromRust: number = 0; // Rustセンパイが教えてくれた総検索結果数！
  let overflowMessageText = ''; // 上限を超えたときに出すメッセージ！

  // -1はinput欄、0～は候補リストのインデックス！
  // selectedIndex は、全体のインデックスを指すようにするよ！
  // (visibleItemsの中のインデックスじゃないから注意！)
  let selectedIndex: number = -1;

  let currentWindowWidth: number | undefined = DEFAULT_WINDOW_WIDTH; // 初期値も設定しておくね！
  let currentWindowX: number | undefined = undefined;
  let currentWindowY: number | undefined = undefined;
  let currentOpacity: number = DEFAULT_WINDOW_OPACITY * 100; // ウィンドウの透明度だよ！0-100の整数で管理！
  let currentBackgroundColor: string = DEFAULT_WINDOW_BACKGROUND_COLOR; // ウィンドウの背景色！ CSSで使える色文字列だよ

  let settingsApplied = false; // 設定が適用されたかな？ (<em>´ω｀</em>)
  let initialSettingsError: string | null = null; // 設定読み込みでエラーが出ちゃった？
  let listVisibleHeight: number = 0; // リスト表示エリアの実際の高さ！ (CSSピクセル)

  let isLoadingMore = false; // 追加のアイテムを読み込み中かな？フラグ！
  let justFocusedByKeyEvent = false; // キーイベントでフォーカスした直後かな？フラグ！ ✨

  /**
   * 指定された色と透明度から `rgba()` 形式のCSS文字列を生成するヘルパー関数だよ！
   * @param color CSSで有効な色文字列 (例: "red", "#FF0000", "rgb(255,0,0)")
   * @param opacityPercent 透明度 (0-100)
   * @returns rgba(r, g, b, a) 形式の文字列
   */
  function getRgbaWithOpacity(color: string, opacityPercent: number): string {
    const opacity = Math.max(0, Math.min(100, opacityPercent)) / 100;
    // 一時的なDOM要素を使って、ブラウザに色を解釈させて "rgb(r, g, b)" 形式を取得するよ
    const tempEl = document.createElement('div');
    tempEl.style.color = color;
    tempEl.style.display = 'none'; // 画面には表示しないよ
    document.body.appendChild(tempEl);
    const computedColor = window.getComputedStyle(tempEl).color;
    document.body.removeChild(tempEl);

    const match = computedColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (match) {
      return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${opacity})`;
    }
    // もし色の解釈に失敗したら、デフォルトの白にフォールバックするね
    console.warn(`色の解釈に失敗しちゃった… ("${color}")。デフォルトの白背景を使うね。`);
    return `rgba(255, 255, 255, ${opacity})`;
  }

  // $: リアクティブステートメントで <main> のスタイルを動的に生成！
  $: mainStyle = `background-color: ${getRgbaWithOpacity(currentBackgroundColor, currentOpacity)};`;

  /**
   * ウィンドウの透明度を設定し、設定を保存する関数
   * @param opacityValue 0から100の整数
   */
  async function setWindowOpacity(opacityValue: number) {
    const newOpacityForTauri = Math.max(0, Math.min(100, opacityValue)) / 100; // 0.0 - 1.0 に変換
    currentOpacity = opacityValue; // UI表示用に0-100で保持
    // const appWindow = WebviewWindow.getCurrent(); // ウィンドウ全体の透明度API呼び出しはしないよ！
    // await appWindow.setOpacity(newOpacityForTauri); // これもコメントアウト！
    await saveWindowSettingsToRust({
      opacity: newOpacityForTauri,
      backgroundColor: currentBackgroundColor, // 背景色も一緒に保存！
      // 他の設定値も現在のものを渡す
      width: currentWindowWidth, x: currentWindowX, y: currentWindowY, displayLimit
    });
  }

  /**
   * ウィンドウの背景色を設定し、設定を保存する関数
   * @param color CSSで有効な色文字列
   */
  async function setWindowBackgroundColor(color: string) {
    currentBackgroundColor = color;
    await saveWindowSettingsToRust({
      backgroundColor: currentBackgroundColor,
      opacity: currentOpacity / 100, // 透明度も現在のものを0.0-1.0で渡す
      width: currentWindowWidth, x: currentWindowX, y: currentWindowY, displayLimit
    });
  }

 /**
  * 検索キーワードで検索し、結果を表示する
  */
async function handleSearch() {
  // ★★★ ここから追加 ★★★
  if (isLoadingMore) {
    console.log('前の検索処理の真っ最中だから、ちょっと待ってね！ (人∀・)ﾀﾉﾑ');
    return; // 処理を中断するよ！
  }
  // ★★★ ここまで追加 ★★★
  // ★★★ ここからコマンド処理の分岐を追加 ★★★
  // searchTerm が `/` で始まる場合はコマンドとして処理するよ！
  if (searchTerm.startsWith('/')) {
    let commandOutputMessage = ''; // コマンド処理の結果メッセージを一時的に保存するおてて！
    // もしヘルプモードだったら、一旦解除するよ
    if (isHelpModeActive) {
      isHelpModeActive = false;
      helpScrollTransformY = 0;
      // ヘルプモードが終了したので、記憶しておいたウィンドウの高さに戻す
      if (previousWindowHeightBeforeHelp !== undefined && currentWindowWidth !== undefined) {
        try {
          await WebviewWindow.getCurrent().setSize(new PhysicalSize(currentWindowWidth, previousWindowHeightBeforeHelp));
        } catch (e) { console.error("ウィンドウ高さの復元に失敗:", e); }
        previousWindowHeightBeforeHelp = undefined;
      }
    }

    await processCommand(
      searchTerm,
      (msg) => { commandOutputMessage = msg; }, // コマンドハンドラからのメッセージはここで受け取るよ
      { // コマンドハンドラに必要なものをまとめて渡すよ！
        setOpacity: setWindowOpacity,
        currentOpacity: currentOpacity, // 現在の透明度も渡す！
        setBackgroundColor: setWindowBackgroundColor, // ← 背景色変更関数を追加！
        currentBackgroundColor: currentBackgroundColor, // ← 現在の背景色も追加！
        // displayLimit関連はコマンドから操作しないようにしたから、もう渡さないよ！ (これは前のコメントのまま)
      }
    );

    if (searchTerm.toLowerCase().startsWith('/help') && commandOutputMessage) {
      // `/help` コマンドだったら、ヘルプモードをON！
      isHelpModeActive = true;
      helpContentText = commandOutputMessage; // ヘルプテキストをセット！
      message = ''; // 通常のメッセージ欄はクリア！
      visibleItems = []; // 検索結果リストもクリア！
      totalResultsCountFromRust = 0; // 検索結果もないので0に
      selectedIndex = -1; // 選択も解除

      // ヘルプモード用にウィンドウの高さを設定
      await tick(); // DOM更新を待ってから要素の高さを取得する
      const searchInputEl = searchInput;
      if (searchInputEl && currentWindowWidth !== undefined) {
        try {
          const currentSize = await WebviewWindow.getCurrent().innerSize();
          previousWindowHeightBeforeHelp = currentSize.height; // 現在の高さを記憶

          const searchInputHeight = searchInputEl.offsetHeight || 40; // 検索入力欄の高さ
          const helpAreaCssHeight = 300; // CSSで指定したヘルプエリアの高さ
          const verticalPaddingAndMargins = 40; // 上下の余白やマージンなど（適宜調整してね！）

          const targetWindowHeight = searchInputHeight + helpAreaCssHeight + verticalPaddingAndMargins;

          await WebviewWindow.getCurrent().setSize(new PhysicalSize(currentWindowWidth, Math.round(targetWindowHeight)));
          // console.log(`ヘルプモード用にウィンドウサイズを ${currentWindowWidth}x${Math.round(targetWindowHeight)} に変更`);
        } catch (e) {
          console.error("ヘルプモード時のウィンドウサイズ変更に失敗:", e);
          // 失敗した場合でも、記憶した高さはリセットしておく（中途半端な状態を防ぐため）
          previousWindowHeightBeforeHelp = undefined;
        }
      }
    } else if (commandOutputMessage) {
      // 通常のコマンド（ヘルプ以外）のメッセージは、今まで通り message 変数で表示するよ
      message = commandOutputMessage;
      visibleItems = []; // 検索結果リストは空にするね
      totalResultsCountFromRust = 0;
      selectedIndex = -1; // 選択も解除！
    }
    return; // コマンド処理をしたら、検索はしないよ！
  }
  // ★★★ ここまでコマンド処理の分岐を追加 ★★★
  message = '';
  if (searchTerm.trim() === '') {
    visibleItems = [];
    visibleStartIndex = 0;
    selectedIndex = -1;
    totalResultsCountFromRust = 0;
    return;
  }
  try {
    // 検索が始まったらヘルプモードは解除するよ
    if (isHelpModeActive) {
      isHelpModeActive = false;
      helpScrollTransformY = 0;
      // ヘルプモードが終了したので、記憶しておいたウィンドウの高さに戻す
      if (previousWindowHeightBeforeHelp !== undefined && currentWindowWidth !== undefined) {
        try {
          await WebviewWindow.getCurrent().setSize(new PhysicalSize(currentWindowWidth, previousWindowHeightBeforeHelp));
        } catch (e) { console.error("ウィンドウ高さの復元に失敗:", e); }
        previousWindowHeightBeforeHelp = undefined;
      }
    }
    isLoadingMore = true;
    const countToLoad = itemsToRenderInView > 0 ? itemsToRenderInView + RENDER_BUFFER_ITEMS * 2 : INITIAL_ITEMS_TO_LOAD;
    const slice = await performSearch(searchTerm, countToLoad);
    visibleItems = slice.items;
    visibleStartIndex = 0;
    totalResultsCountFromRust = slice.total_count;
    for (const item of visibleItems) {
      fetchAndSetIconType(item.path);
    }
    // selectedIndex = visibleItems.length > 0 ? 0 : -1; 
    // ↑ 検索直後は、ユーザーが明示的に選択するまで selectedIndex は -1 (入力欄) のままにしたいので、ここでは設定しないよ！
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

  // 検索が終わったら、selectedIndex を -1 に戻して、
  // 「入力欄にフォーカスがあるよ」って状態をはっきりさせるね！
  // これで、もう一度Enterキーを押したときに、意図せずアイテムが実行されちゃうのを防げるはず！ (๑•̀ㅂ•́)و✧
  selectedIndex = -1;
  if (searchInput) { // searchInput がちゃんとあれば…
    await tick();    // DOMの更新をちょっと待ってから…
    searchInput.focus(); // 入力欄にキュピーン！とフォーカスを戻すよ！
  }
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
  const itemIndex = visibleItems.findIndex(i => i.path === itemPath);

  if (itemIndex === -1 || visibleItems[itemIndex].iconType !== undefined) {
    // アイテムが見つからないか、アイコンが既に取得/設定済みの場合は何もしないよ
    return;
  }

  try {
    const type = await getIconType(itemPath);
    const newVisibleItems = [...visibleItems]; // Svelteのリアクティビティのために新しい配列を作るよ
    const itemToUpdate = newVisibleItems[itemIndex];

    if (type === 'file' || type === 'folder') {
      itemToUpdate.iconType = type;
    } else {
      itemToUpdate.iconType = null; // fileでもfolderでもなければnullにするね
    }
    visibleItems = newVisibleItems;
  } catch (error) {
    console.warn(`アイコンタイプの取得に失敗 (path: ${itemPath}):`, error);
    // エラー時もiconTypeをnullにして、再取得ループを防ぐようにするよ
    try {
      const newVisibleItemsOnError = [...visibleItems];
      if (newVisibleItemsOnError[itemIndex]) { //念のため、まだアイテムが存在するか確認
        newVisibleItemsOnError[itemIndex].iconType = null;
        visibleItems = newVisibleItemsOnError;
      }
    } catch (e) {
      // 万が一 newVisibleItemsOnError[itemIndex] でエラーが出ても握りつぶす (ほぼありえないけど念のため)
      console.error('アイコンタイプ設定中の予期せぬエラー:', e);
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

  // ensureSelectedItemVisibleAndFocused に渡す共通の引数をまとめるヘルパーだよ！
  const getBaseFocusArgs = () => ({
    visibleStartIndex,
    visibleItems,
    totalResultsCountFromRust,
    itemsToRenderInView,
    fetchItems,
    setSelectedIndex: (idx: number) => { selectedIndex = idx; },
    tickFn: tick,
    isTriggeredByKeyEvent: true, // キーイベント起因であることは固定だね！
    resetKeyEventFlag: true,    // フォーカスフラグのリセットもお願いするよ！
    RENDER_BUFFER_ITEMS,
    INITIAL_ITEMS_TO_LOAD,
    FOCUS_RETRY_LIMIT,
    itemHeight,
    setJustFocusedByKeyEvent: (v: boolean) => { justFocusedByKeyEvent = v; }
  });

  // 新しいインデックスに選択を移して、フォーカスと表示を調整するヘルパーだよ！
  async function navigateAndFocus(newIndex: number) {
    selectedIndex = newIndex;
    justFocusedByKeyEvent = true; // キーでフォーカスしたよ！ってフラグを立てる！
    await ensureSelectedItemVisibleAndFocused({
      ...getBaseFocusArgs(),
      selectedIndex: selectedIndex, // 現在のselectedIndexを渡すよ
      justFocusedByKeyEvent: justFocusedByKeyEvent, // 現在のフラグの状態を渡すよ
    });
    // ensureSelectedItemVisibleAndFocused の中で resetKeyEventFlag が true だから、
    // justFocusedByKeyEvent は false になってるはず！ ( *´艸｀)
  }

  async function handleKeydown(event: KeyboardEvent) {
    // ★★★ ヘルプモード中のキー操作をここに追加！ ★★★
    if (isHelpModeActive) {
      if (event.key === 'ArrowUp') {
        event.preventDefault(); // デフォルトのスクロールとかを防ぐよ！
        // ヘルプを上にスクロール（transformYを増やす）
        helpScrollTransformY = Math.min(0, helpScrollTransformY + HELP_LINE_HEIGHT_PX);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        // messageAreaElementRef (表示コンテナ) と helpInnerContentElementRef (実際のテキストコンテンツ) が必要だよ！
        if (messageAreaElementRef && helpInnerContentElementRef) {
          const contentActualHeight = helpInnerContentElementRef.offsetHeight;
          const containerVisibleHeight = messageAreaElementRef.clientHeight;
          // ヘルプを下にスクロール（transformYを減らす）
          // ただし、コンテンツの下端が表示エリアの下端より上には行かないようにするよ！
          // (コンテンツ高さ - コンテナ表示高さ) がスクロールできる最大マイナス値
          const maxScrollDownNegative = Math.min(0, containerVisibleHeight - contentActualHeight);

          helpScrollTransformY = Math.max(maxScrollDownNegative, helpScrollTransformY - HELP_LINE_HEIGHT_PX);
        }
      } else if (event.key === 'Escape') {
        // Escキーでヘルプモードを解除！
        isHelpModeActive = false;
        helpContentText = ''; // ヘルプ内容もクリア
        helpScrollTransformY = 0; // スクロール位置もリセット

        // ヘルプモード解除時にウィンドウの高さを元に戻す
        if (previousWindowHeightBeforeHelp !== undefined && currentWindowWidth !== undefined) {
          try {
            await WebviewWindow.getCurrent().setSize(new PhysicalSize(currentWindowWidth, previousWindowHeightBeforeHelp));
          } catch (e) { console.error("ウィンドウ高さの復元に失敗:", e); }
          previousWindowHeightBeforeHelp = undefined;
        }
        await tick(); // DOM更新や他のリアクティブな処理を待つ

        if (searchInput) {
          searchInput.focus();
          // Escでヘルプ解除時は searchTerm をクリアしてもいいかも？
          // searchTerm = ''; // 必要ならコメントアウト解除
        }
        return; // Escキーの処理はここまで
      }
      // --- ここから、ヘルプモード中に文字入力があった場合の処理を追加 ---
      // event.key が1文字の printable character で、CtrlやAltが押されてない場合
      if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        // ヘルプモードを解除！
        isHelpModeActive = false;
        helpContentText = '';
        helpScrollTransformY = 0;
        if (previousWindowHeightBeforeHelp !== undefined && currentWindowWidth !== undefined) {
          try {
            await WebviewWindow.getCurrent().setSize(new PhysicalSize(currentWindowWidth, previousWindowHeightBeforeHelp));
          } catch (e) { console.error("ウィンドウ高さの復元に失敗:", e); }
          previousWindowHeightBeforeHelp = undefined;
        }
        // searchTerm を入力された文字で更新して、入力欄にフォーカスを戻す
        // searchTerm = event.key; // ← これだと1文字だけになっちゃうので、handleSearchに任せる
        if (searchInput) {
          searchInput.focus(); // まずフォーカス
          // searchInput.value に直接セットするよりは、
          // この後の通常のキー処理に任せて searchTerm が更新されるのを期待する方が自然かも。
          // あるいは、ここで searchTerm = event.key; して handleSearch() を呼ぶか。
          // ここでは、ヘルプモードを抜けるだけにして、後続の処理で searchTerm が更新されるのを待つ形にしてみるね。
        }
        // selectedIndex もリセットしておくのが安全だね！
        selectedIndex = -1;
        // ヘルプモードを抜けたので、以降の通常のキー処理に進ませるために return しないよ！
      } else {
        // 上下矢印、Esc、文字入力以外のキーはヘルプモード中は無視する
        return;
      }
    }
    // ★★★ ここまで追加 ★★★
    const maxSelectableIndex = itemCount - 1;

    if (itemCount > 0) { // アイテムがあるときだけナビゲーションするよ！
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (selectedIndex < maxSelectableIndex) {
          await navigateAndFocus(selectedIndex + 1);
        } else {
          await navigateAndFocus(-1); // 一番下からさらに下で入力欄に戻るよ
        }
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (selectedIndex === -1 && itemCount > 0) { // 入力欄から上で一番最後のアイテムへ
          await navigateAndFocus(maxSelectableIndex);
        } else if (selectedIndex > 0) {
          await navigateAndFocus(selectedIndex - 1);
        } else { // アイテム0番からさらに上で入力欄に戻るよ
          await navigateAndFocus(-1);
        }
      } else if (event.key === 'Tab') {
        if (!event.shiftKey && selectedIndex === -1 && itemCount > 0) { // Tabで入力欄から最初のアイテムへ
          event.preventDefault();
          await navigateAndFocus(0);
        } else if (event.shiftKey && selectedIndex === 0) { // Shift+Tabで最初のアイテムから入力欄へ
          event.preventDefault();
          await navigateAndFocus(-1);
        }
        // Tabキーの他の挙動はデフォルトに任せるよ (リスト内でのTab移動はここでは扱わない)
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        // アイテムが選択されてる時に ← → で入力欄に戻るよ！
        if (selectedIndex !== -1) {
          event.preventDefault();
          await navigateAndFocus(-1);
        }
        // 入力欄がフォーカスされてる時の ← → はデフォルトのカーソル移動に任せるよ
      } else if (event.key === 'Enter') { // Enterキーの処理！
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
          handleSearch(); // 選択されてない時は検索実行！
        }
      }
    } else if (event.key === 'Enter') {
      handleSearch();
    }
  }

  async function handleResultKeydown(event: KeyboardEvent, idx: number) {
    const maxSelectableIndex = itemCount - 1;
    const globalCurrentIndex = visibleStartIndex + idx; // このアイテムの全体でのインデックス

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Tab') {
      // ArrowUp, ArrowDown, Tab は handleKeydown のロジックをそのまま使うよ！
      // selectedIndex は handleKeydown の中で更新されるから、ここでは何もしなくてOK！
      await handleKeydown(event); 
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      await navigateAndFocus(-1); // ← で入力欄に戻る！
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      // 元のコードでは → で最後のアイテムに飛んでたね！面白い挙動！(・∀・)
      // もしこれが意図した動作なら、これでOK！
      // もし入力欄に戻したいなら navigateAndFocus(-1) だね！
      await navigateAndFocus(maxSelectableIndex);
    } else if (event.key === 'Enter') {
      // Enterキーでアイテムを実行！
      // globalCurrentIndex はこのアイテム自身のインデックスだから、これを使うよ！
      // selectedIndex がこのアイテムを指していることを確認してもいいかもだけど、
      // Enterイベントがこのアイテムで起きてるなら、このアイテムを実行するのが自然だね！
      if (globalCurrentIndex >= 0 && globalCurrentIndex < totalResultsCountFromRust) {
        const itemToExecute = getItemByGlobalIndex(globalCurrentIndex, visibleStartIndex, visibleItems);
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
      if (key === 'currentOpacity') currentOpacity = value; // 0-100で受け取る
      if (key === 'currentBackgroundColor') currentBackgroundColor = value; // 背景色も受け取る！
      if (key === 'displayLimit') displayLimit = value;
    };

    // 設定を読み込んで反映
    loadWindowSettings()
      .then(async settings => {
        console.log('やったー！設定が届いたよ！ ☆:.｡. o(≧▽≦)o .｡.☆', settings);
        await applyInitialSettings(settings, setState);
        // applyInitialSettings で currentOpacity (0-100) がセットされた後、
        // 実際のウィンドウに透明度を適用するよ！
        if (settings?.opacity !== undefined) {
          // const appWindow = WebviewWindow.getCurrent(); // ウィンドウ全体の透明度API呼び出しはしない！
          // await appWindow.setOpacity(settings.opacity); // これもコメントアウト！
        }
        initialSettingsError = null;
      })
      .catch(async err => {
        console.error('うにゃ～ん、設定読み込みでエラーだって… (´；ω；｀)', err);
        initialSettingsError = String(err);
        // エラー時もデフォルト値で初期化
        await applyInitialSettings({ width: DEFAULT_WINDOW_WIDTH, opacity: DEFAULT_WINDOW_OPACITY, displayLimit, backgroundColor: DEFAULT_WINDOW_BACKGROUND_COLOR }, setState);
        // デフォルトの透明度をウィンドウに適用 (これもAPI呼び出しはしないよ！)
        // const appWindow = WebviewWindow.getCurrent();
        // await appWindow.setOpacity(DEFAULT_WINDOW_OPACITY);
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
    const handleWheel = async (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
        const deltaY = event.deltaY > 0 ? -5 : 5; // 5%ずつ変更
        let newOpacityValue = Math.max(0, Math.min(100, currentOpacity + deltaY));
        newOpacityValue = Math.round(newOpacityValue / 5) * 5; // 5の倍数に丸める (0, 5, 10 ... 100)
        if (newOpacityValue === 0) newOpacityValue = 1; // 完全に透明は避けたいので最低1%
        await setWindowOpacity(newOpacityValue); // 0-100の値を渡す
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: false });

    currentAppWindow.onResized(async ({ payload: size }) => {
      currentWindowWidth = size.width;
      // 透明度は currentOpacity (0-100) を 100で割って0.0-1.0にして保存
      await saveWindowSettingsToRust({ width: currentWindowWidth, x: currentWindowX, y: currentWindowY, opacity: currentOpacity / 100, displayLimit, backgroundColor: currentBackgroundColor });
    }).then(unlistener => {
      unlistenResizedFn = unlistener;
    });

    currentAppWindow.onMoved(async ({ payload: position }) => {
      currentWindowX = position.x;
      currentWindowY = position.y;
      await saveWindowSettingsToRust({ width: currentWindowWidth, x: currentWindowX, y: currentWindowY, opacity: currentOpacity / 100, displayLimit, backgroundColor: currentBackgroundColor });
    }).then(unlistener => {
      unlistenMovedFn = unlistener;
    });

    // --- ホットキーイベントのリスナーを登録！ ---
    // Rust側から 'toggle-window' イベントが来たら、ウィンドウの表示/非表示を切り替えるよ！
    listen<null>('toggle-window', async () => {
      console.log('ホットキーイベント "toggle-window" を受信したよ！');
      const currentAppWindow = WebviewWindow.getCurrent();
      const isVisible = await currentAppWindow.isVisible();
      const isFocused = await currentAppWindow.isFocused();

      if (isVisible && isFocused) {
        // 表示されてて、かつフォーカスもされてたら非表示にするよ！
        await currentAppWindow.hide();
      } else if (isVisible && !isFocused) {
        // 表示はされてるけど、フォーカスが外れてたらフォーカスを当てるね！
        await currentAppWindow.setFocus();
        if (searchInput) {
          searchInput.focus(); // 検索欄にもフォーカス！ (๑•̀ㅂ•́)و✧
        }
      } else {
        // 非表示だったら、表示してフォーカスするよ！
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
  $: if (!isHelpModeActive) { // ★★★ ヘルプモードじゃない時だけ、ウィンドウとリストの高さ調整を実行するよ！ ★★★
    calcListAndWindowHeight({
      message,
      itemCount,
      overflowMessageText,
      settingsApplied,
      currentWindowWidth,
      PhysicalSize,
      WebviewWindow,
      setListVisibleHeight: (h) => { listVisibleHeight = h; }
    });
  }

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

<main
  class:main-loading={isLoadingMore}
  style={mainStyle}
>
  <div class={styles['search-container']}>
    <input
      type="text"
      bind:value={searchTerm}
      bind:this={searchInput}
      on:keydown={handleKeydown}
      on:focus={() => { selectedIndex = -1; }}
      placeholder="検索キーワードを入力..."
      aria-label="検索キーワード"
      class="{styles.input} {isLoadingMore ? styles['input-loading'] : ''}"
    />
  </div>

  {#if isLoadingMore}
    <p class={styles['loading-message']}>検索してるよ... ちょっと待ってね！ ٩(ˊᗜˋ*)و</p>
  {/if}

  {#if isHelpModeActive && helpContentText}
    <!-- ヘルプモードの時は、message要素に特別なクラスをつけて、中身もヘルプ専用にするよ！ -->
    <div
      bind:this={messageAreaElementRef}
      class="{styles.message} {styles['message-as-help-scroll']}"
      role="document" 
      aria-live="polite"
    >
      <div
        bind:this={helpInnerContentElementRef}
        class={styles['help-scroll-inner-text']}
        style="transform: translateY({helpScrollTransformY}px);"
      >
        {helpContentText}
      </div>
    </div>
  {:else if message && !isHelpModeActive}
    <!-- 通常のメッセージ表示 (ヘルプモードじゃない時だけ) -->
    <p class:error-message={message.includes('エラー')} class={styles.message} role="status" aria-live="polite">{message}</p>
  {/if}

  {#if totalResultsCountFromRust > 0 && !isHelpModeActive} <!-- ヘルプモードの時は結果リストは表示しないよ -->
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
            class="{styles.item} {selectedIndex === globalIndex ? styles.selected : ''}"
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
    {#if selectedIndex >= 0 && totalResultsCountFromRust > 0 && visibleItems.length > 0 && !isHelpModeActive}
      <p class={styles['position-info']}>
        ({selectedIndex + 1} / {totalResultsCountFromRust})
      </p>
    {/if}
    {#if overflowMessageText && totalResultsCountFromRust > displayLimit && !isHelpModeActive}
      <p class={styles['overflow-message']}>{overflowMessageText}</p>
    {/if}
  {/if}
</main>

<style src="./+page.module.css"></style>
