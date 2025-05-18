<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { PhysicalSize, PhysicalPosition } from '@tauri-apps/api/window';
  import { invoke } from '@tauri-apps/api/core';
  import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
  // import { searchFiles, type SearchResult } from '../lib/searcher'; // ← Rust側で検索するので、このimportはもういらないかな？
  // import { List } from 'svelte-virtual'; // ← svelte-virtual とは一旦お別れ！ (´；ω；｀)ﾉｼ

  let searchInput: HTMLInputElement; // input要素を後でつかまえるためのおてて！
  let searchTerm: string = '';
  let message: string = '';

  // let searchResults: SearchResult[] = []; // ← この子はもう使わないかも！代わりに visibleItems を使うよ！
  let visibleItems: SearchResult[] = []; // 今、画面に見えてる範囲のアイテムたち！ ✨
  let visibleStartIndex: number = 0;     // visibleItems が、全体の何番目から始まってるか！

  let displayLimit: number = -1; // デフォルトは無制限！
  let totalResultsCountFromRust: number = 0; // Rustセンパイが教えてくれた総検索結果数！
  let overflowMessageText = ''; // 上限を超えたときに出すメッセージ！

  let selectedIndex: number = -1; // -1はinput欄、0～は候補リストのインデックス！
                                 // selectedIndex は、全体のインデックスを指すようにするよ！
                                 // (visibleItemsの中のインデックスじゃないから注意！)
  // let listRef: any; // Listコンポーネントの参照（型はanyでOK）
                    // ↑ svelte-virtual を使わなくなったら、これも役割が変わるか不要になるかも！

  // SearchResultの型定義 (Rust側のSearchResultと形を合わせるのが大事だよ！)
  interface SearchResult {
    name: string;
    path: string;
  }

  // ウィンドウの高さ調整のための定数だよ！ (｡•̀ω-)b
  const baseHeight = 50; // 入力欄とかパディングとかの基本的な高さ！
  const itemHeight = 35; // 検索結果1件あたりのだいたいの高さ！
  const messageLineHeight = 25; // メッセージ1行あたりのだいたいの高さ！
  const maxHeight = 400; // これ以上は大きくならないようにする上限！
  let currentWindowWidth: number | undefined = undefined;
  let currentWindowX: number | undefined = undefined;
  let currentWindowY: number | undefined = undefined;
  let currentOpacity: number = 1.0; // ウィンドウの透明度だよ！最初はくっきり！

  const INITIAL_ITEMS_TO_LOAD = 30; // 最初にRustから読み込むアイテムの数 (お好みで調整してね！)
  const RENDER_BUFFER_ITEMS = 10;   // 見えてる範囲の上下に、これくらい余分に描画しとくバッファ！
  let itemsToRenderInView = 0;      // 実際に一度に画面に描画するアイテムの数 (listVisibleHeight から計算)

  let settingsApplied = false; // 設定が適用されたかな？ (<em>´ω｀</em>)
  let initialSettingsError: string | null = null; // 設定読み込みでエラーが出ちゃった？
  let listVisibleHeight: number = 0; // リスト表示エリアの実際の高さ！
  
  let isLoadingMore = false; // 追加のアイテムを読み込み中かな？フラグ！
  const SCROLL_THRESHOLD_ITEMS = 5; // 残り何アイテムで見えそうになったら次を読み込むか (お好みで！)
  let justFocusedByKeyEvent = false; // キーイベントでフォーカスした直後かな？フラグ！ ✨

  interface WindowSettings {
    width?: number;
    x?: number;
    y?: number;
    opacity?: number;
    displayLimit?: number; // 追加！
  }

  // Rustから返ってくる検索結果スライスデータの形を定義しておくね！
  interface SearchResultSlice {
    items: SearchResult[];
    total_count: number;
  }

  async function handleSearch() {
    message = ''; // メッセージを一旦消しとこ！
    if (searchTerm.trim() === '') {
      message = '何か入力してね！ (｡•́︿•̀｡)';
      // searchResults = [];
      visibleItems = [];
      visibleStartIndex = 0;
      selectedIndex = -1; // 検索結果がないときは選択もリセット！
      totalResultsCountFromRust = 0; // 総件数もリセット！
    } else {
      try {
        console.log(`Searching for: "${searchTerm}"`);
        isLoadingMore = true; // 最初の読み込みも「読み込み中」扱い！
        // Rustの `perform_search` コマンドを呼び出すよ！
        // itemsToRenderInView が計算されてからの方がいいけど、初回は多めに取っておく！
        const countToLoad = itemsToRenderInView > 0 ? itemsToRenderInView + RENDER_BUFFER_ITEMS * 2 : INITIAL_ITEMS_TO_LOAD;
        const slice = await invoke<SearchResultSlice>('perform_search', {
          keyword: searchTerm,
          initialCount: countToLoad
        });
        // searchResults = slice.items;
        visibleItems = slice.items;
        visibleStartIndex = 0; // 最初だから0番目から！
        totalResultsCountFromRust = slice.total_count; // Rustが教えてくれた総件数！
        console.log(`Rust found ${totalResultsCountFromRust} total results. Displaying ${visibleItems.length} initial items.`);
        selectedIndex = visibleItems.length > 0 ? 0 : -1; // 結果があれば最初のアイテムを選択状態にしてみる？
        if (totalResultsCountFromRust === 0) {
          message = `「${searchTerm}」は見つからなかったよ… (´・ω・｀)`;
        }
      } catch (error) {
        console.error('Search failed:', error); // 開発者向けログは残しとこ！
        let userFriendlyMessage = `検索中にエラーが起きちゃったみたい… (´；ω；｀)\nもう一度試してみてね。`;
        // エラーメッセージに特徴的な文字列が含まれていたら、もっと具体的なヒントを出すよ！
        if (String(error).includes('invalid type: map, expected a sequence')) {
          userFriendlyMessage = `検索結果のデータの形がちょっとおかしかったみたいで、うまく表示できなかったの… (｡>﹏<｡)\nもしかしたら、1件だけ見つかったときにこの問題が起きるのかも？\nもし何度も起きるようなら、アプリの開発者さんにこのことを伝えてみてね！`;
        }
        message = userFriendlyMessage;
        // searchResults = [];
        visibleItems = [];
        visibleStartIndex = 0;
        selectedIndex = -1;
        totalResultsCountFromRust = 0; // エラー時もリセット！
      } finally {
        isLoadingMore = false;
      }
    }
    // 検索結果の数に応じてオーバーフローメッセージを更新するよ！
    // visibleItems.length じゃなくて totalResultsCountFromRust で判断するよ！
    if (displayLimit !== -1 && totalResultsCountFromRust > displayLimit) {
      overflowMessageText = `他にも ${totalResultsCountFromRust - displayLimit} 件あるよ！ もっと絞り込んでね！ (ゝ∀･)⌒☆`;
    } else {
      overflowMessageText = '';
    }
    // スクロール位置もリセット！
    const listContainer = document.querySelector('.results-list-scroll-container');
    if (listContainer) listContainer.scrollTop = 0;
  }

  // 指定された範囲のアイテムをRustから読み込む関数だよ！
  async function fetchItems(startIndex: number, count: number) {
    if (isLoadingMore) return; // 既に何か読み込んでたら待って！
    if (totalResultsCountFromRust > 0 && startIndex >= totalResultsCountFromRust) {
      console.log('もう全部読み込んでるか、範囲外だよ！');
      return;
    }
    isLoadingMore = true;
    console.log(`アイテムを読み込むよ！ 開始: ${startIndex}, 数: ${count}`);

    // 実際にRustに要求する開始位置と数 (マイナスにならないように！)
    const actualStartIndex = Math.max(0, startIndex);
    const actualCount = Math.max(1, count); // 最低1件は取る！

    try {
      const slice = await invoke<SearchResultSlice>('get_search_results_slice', {
        startIndex: actualStartIndex,
        count: actualCount
      });

      if (slice.items.length > 0) {
        visibleItems = slice.items; // 新しいアイテムで置き換える！
        visibleStartIndex = actualStartIndex; // 表示開始位置も更新！
        console.log(`${slice.items.length} 件ゲット！ 表示開始: ${visibleStartIndex}, 表示アイテム数: ${visibleItems.length}`);
      } else {
        console.log('指定範囲のアイテムはなかったか、もう終わりみたい！');
        // もし要求した範囲より手前しかアイテムがなかった場合、
        // visibleItems が空になる可能性があるので、最後の有効な範囲で再取得を試みるのもアリかも？
        // (今回はシンプルにするために省略！)
      }
      // totalResultsCountFromRust も念のため更新 (変わらないはずだけどね！)
      totalResultsCountFromRust = slice.total_count; 
    } catch (error) {
      console.error('アイテムの読み込みに失敗しちゃった… (´；ω；｀)', error);
      // ここでユーザーにエラーメッセージを出すかは、お好みで！
    } finally {
      isLoadingMore = false;
    }
    // fetchItemsが終わった後、もし何か選択されてたら、
    // そのアイテムがちゃんと見えるように再調整するよ！ (๑•̀ㅂ•́)و✧
    if (selectedIndex !== -1) {
      // キーイベントでフォーカスした直後だけ、選択アイテムを中央に持ってくるようにする！
      if (justFocusedByKeyEvent) {
        await ensureSelectedItemVisibleAndFocused(true, true); // キーイベント起因で、かつフラグをリセットしてね！って印を渡す！
        // justFocusedByKeyEvent = false; // ← ここでのリセットはやめて、ensureSelectedItemVisibleAndFocused の中でやる！
      }
    }
  }

  // 古い loadMoreResults はもう使わないのでコメントアウトか削除！
  // async function loadMoreResults() { ... }

  // listVisibleHeight が変わったら、一度に描画するアイテム数を再計算！
  $: if (listVisibleHeight > 0 && itemHeight > 0) {
    itemsToRenderInView = Math.ceil(listVisibleHeight / itemHeight);
    console.log(`リスト表示高さ: ${listVisibleHeight}px, 1アイテム高さ: ${itemHeight}px => 描画アイテム数: ${itemsToRenderInView}`);
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
        await ensureSelectedItemVisibleAndFocused(true, true); // await をつけて、処理が終わるのを待つ！フラグリセットもお願い！
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
        await ensureSelectedItemVisibleAndFocused(true, true);
      } else if (event.key === 'Tab') {
        if (!event.shiftKey && selectedIndex === -1 && itemCount > 0) {
          event.preventDefault();
          selectedIndex = 0;
          // tick().then(focusCurrent);
          justFocusedByKeyEvent = true;
          await ensureSelectedItemVisibleAndFocused(true, true);
        } else if (event.shiftKey && selectedIndex === 0) {
          event.preventDefault();
          selectedIndex = -1;
          // tick().then(focusCurrent);
          justFocusedByKeyEvent = true;
          await ensureSelectedItemVisibleAndFocused(true, true);
        }
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        // リストアイテムが選択されている場合のみ、←→でinput欄に戻る！
        if (selectedIndex !== -1) {
          event.preventDefault();
          selectedIndex = -1;
          // tick().then(focusCurrent);
          justFocusedByKeyEvent = true;
          await ensureSelectedItemVisibleAndFocused(true, true);
        }
      } else if (event.key === 'Enter') {
        if (selectedIndex >= 0 && selectedIndex < totalResultsCountFromRust && visibleItems.length > 0) {
          const itemToExecute = getItemByGlobalIndex(selectedIndex);
          if (itemToExecute) executeResult(itemToExecute);
        } else {
          handleSearch();
        }
      }
    } else if (event.key === 'Enter') {
      handleSearch();
    }
  }

  // --- 仮想リストの選択インデックスが変わったら必ずscrollTo！ ---
  // svelte-virtual を使わなくなったので、このリアクティブブロックは一旦コメントアウト！
  // スクロールは自前でやるか、別の方法を考えるよ！
  /* $: if (selectedIndex >= 0 && listRef && typeof listRef.scrollTo?.index === 'function') {
    // listRef.scrollTo.index(selectedIndex, { behavior: 'auto', alignment: 'start' }); // 'start' の方が見やすいかも？
  } */

  // selectedIndex (全体のインデックス) から、今表示してる visibleItems の中のアイテムを探すヘルパー
  function getItemByGlobalIndex(globalIndex: number): SearchResult | undefined {
    if (globalIndex >= visibleStartIndex && globalIndex < visibleStartIndex + visibleItems.length) {
      return visibleItems[globalIndex - visibleStartIndex];
    }
    return undefined;
  }

  // 選択されたアイテムが表示範囲内にあるか確認し、必要ならデータを読み込んでフォーカス＆スクロールする関数！
  async function ensureSelectedItemVisibleAndFocused(isTriggeredByKeyEvent: boolean = false, resetKeyEventFlag: boolean = false) { // 第2引数を追加！
    // console.log(`[ensureSelectedItemVisibleAndFocused] 呼び出されました。isTriggeredByKeyEvent: ${isTriggeredByKeyEvent}, resetKeyEventFlag: ${resetKeyEventFlag}, selectedIndex: ${selectedIndex}`);
    // まずSvelteの反映を待つよ！(tick)
    await tick();

    if (selectedIndex === -1) {
      if (searchInput) searchInput.focus();
      return;
    }

    // 1. 選択されたアイテムが現在の visibleItems に含まれているか？
    const currentItem = getItemByGlobalIndex(selectedIndex);
    if (currentItem) {
      // あれば、フォーカスとスクロールを試みる
      // console.log(`[ensureSelectedItemVisibleAndFocused] アイテム ${selectedIndex} は表示範囲内です。focusAndScrollToSelectedItem(${isTriggeredByKeyEvent}) を呼びます。`);
      await focusAndScrollToSelectedItem(isTriggeredByKeyEvent); // 引数を渡す！
    } else {
      // なければ、そのアイテムを含む範囲のデータを読み込む
      console.log(`選択アイテム ${selectedIndex} は今の表示範囲外だよ。新しい範囲を読み込むね！`);
      // selectedIndex を中心に、itemsToRenderInView + バッファ分 のデータを読み込む

      // 1つの表示ウィンドウで読み込むアイテムの数 (画面に見える数 + 上下バッファ)
      // これは handleScroll と同じ計算にするよ！
      const windowItemCount = (itemsToRenderInView > 0 ? itemsToRenderInView : INITIAL_ITEMS_TO_LOAD) + RENDER_BUFFER_ITEMS * 2;
      
      // 新しい表示ウィンドウの開始インデックスを計算するよ！
      // selectedIndex がウィンドウの中心あたりに来るように調整！
      let newFetchStartIndex = Math.max(0, selectedIndex - Math.floor(windowItemCount / 2));
      // ただし、最後まで表示しきれるように、末尾でのはみ出しも調整！
      // (totalResultsCountFromRust - windowItemCount) がマイナスになる場合も考慮して Math.max(0, ...) を入れる！
      newFetchStartIndex = Math.min(newFetchStartIndex, Math.max(0, totalResultsCountFromRust - windowItemCount));
      newFetchStartIndex = Math.max(0, newFetchStartIndex); // 念のため、0未満にならないように！
      
      await fetchItems(newFetchStartIndex, windowItemCount); // countToFetch -> windowItemCount
      // データ読み込み後、再度フォーカスとスクロールを試みる
      await tick(); // fetchItems の後のDOM更新を待つ！
      // console.log(`[ensureSelectedItemVisibleAndFocused] fetchItems 後、再度 focusAndScrollToSelectedItem(${isTriggeredByKeyEvent}) を呼びます。`);
      await focusAndScrollToSelectedItem(isTriggeredByKeyEvent); // 引数を渡す！
    }
    // キーイベント起因で、かつフラグをリセットしてね！って言われたら、ここでリセット！
    if (isTriggeredByKeyEvent && resetKeyEventFlag) {
      justFocusedByKeyEvent = false;
      // console.log('[ensureSelectedItemVisibleAndFocused] justFocusedByKeyEvent を false に戻しました。');
    }
  }

  // 実際にフォーカスとスクロールを行う関数 (ensureSelectedItemVisibleAndFocusedから呼ばれる)
  async function focusAndScrollToSelectedItem(isTriggeredByKeyEvent: boolean = false) { // 引数を追加！
    const resultsContainer = document.querySelector('.results-list-scroll-container') as HTMLElement | null;
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (selectedIndex === -1) {
      // searchInputが確実に存在するときだけフォーカスするね！
      if (searchInput) searchInput.focus();
      return;
    }

    // visibleItems の中の、selectedIndex に対応するローカルインデックスを探す！
    const localIndex = selectedIndex - visibleStartIndex;

    // ★★★ ブラウザのおせっかい対策！ ★★★
    // この関数の処理が始まる前の scrollTop を覚えておく！
    const scrollTopBeforeFocusLogic = resultsContainer ? resultsContainer.scrollTop : 0;

    if (resultsContainer && localIndex >= 0 && localIndex < visibleItems.length) {
      // console.log(`フォーカス試行: global ${selectedIndex}, local ${localIndex}, visibleStart ${visibleStartIndex}`);
      // 要素が現れるまで最大30回くらいリトライしてみるね！
      // data-index は全体のインデックス (selectedIndex) を使うようにする！
      // 各リトライでSvelteの更新とブラウザのレンダリングを待つのがポイントだよ！
      for (let i = 0; i < 30; i++) {
        await tick();
        // requestAnimationFrame も入れて、ブラウザの描画タイミングを待つ！
        await new Promise(requestAnimationFrame);

        const targetElement = resultsContainer.querySelector(`div[data-index="${selectedIndex}"]`) as HTMLElement | null;

        // console.log(`リトライ ${i}: targetElement for index ${selectedIndex}:`, targetElement);
        if (targetElement) {
          targetElement.focus();
          // ★★★ ブラウザのおせっかい対策！ focus() の直後に scrollTop をチェック！ ★★★
          if (resultsContainer && resultsContainer.scrollTop !== scrollTopBeforeFocusLogic) {
            // console.warn(`[FAS] focus() の直後、scrollTop が ${scrollTopBeforeFocusLogic} から ${resultsContainer.scrollTop} に変わっちゃってたので、元に戻します！`);
            resultsContainer.scrollTop = scrollTopBeforeFocusLogic;
          }

          // キーイベントが原因のときだけ、積極的にスクロールさせる！
          if (isTriggeredByKeyEvent && resultsContainer) { // resultsContainer が null でないことも確認
            const initialScrollTop = resultsContainer.scrollTop; // スクロール前のscrollTop
            // console.log(`[FAS] initialScrollTop: ${initialScrollTop}, selectedIndex: ${selectedIndex}, visibleStartIndex: ${visibleStartIndex}`);

            const containerRect = resultsContainer.getBoundingClientRect();
            const targetRect = targetElement.getBoundingClientRect();
            // console.log(`[FAS] containerRect: top=${containerRect.top.toFixed(0)}, bottom=${containerRect.bottom.toFixed(0)}, height=${containerRect.height.toFixed(0)}`);
            // console.log(`[FAS] targetRect: top=${targetRect.top.toFixed(0)}, bottom=${targetRect.bottom.toFixed(0)}, height=${targetRect.height.toFixed(0)}`);
            // console.log(`[FAS] targetElement.offsetTop: ${targetElement.offsetTop}`);

            let newScrollTop = initialScrollTop; // 計算用の変数 (現在のscrollTopで初期化)
            const bufferPx = RENDER_BUFFER_ITEMS * itemHeight / 4; // バッファのピクセル数 (約アイテム2.5個分の上半分くらい)

            // アイテムがコンテナの上端より「完全に」上にはみ出てたら、上にスクロール
            if (targetRect.bottom < containerRect.top) {
              // アイテムの上端がコンテナの上端に来るようにスクロール (ちょっとだけ余裕を持たせる)
              newScrollTop = targetElement.offsetTop - bufferPx;
              // console.log(`[FAS] 完全に上にはみ出ています。 calculated newScrollTop: ${newScrollTop.toFixed(0)} (targetTop: ${targetElement.offsetTop} - buffer: ${bufferPx.toFixed(0)})`);
            } 
            // アイテムがコンテナの下端より「完全に」下にはみ出てたら、下にスクロール
            else if (targetRect.top > containerRect.bottom) {
              // アイテムの下端がコンテナの下端に来るようにスクロール (ちょっとだけ余裕を持たせる)
              // targetElement.offsetTop はアイテムの上端の位置なので、そこから (コンテナの高さ - アイテムの高さ) を引くと、
              // アイテムの下端がコンテナの下端に来るような scrollTop になるはず！
              newScrollTop = (targetElement.offsetTop + itemHeight) - resultsContainer.clientHeight + bufferPx;
              // console.log(`[FAS] 完全に下にはみ出ています。 calculated newScrollTop: ${newScrollTop.toFixed(0)} (targetBottomAtContainerBottom: ${(targetElement.offsetTop + itemHeight) - resultsContainer.clientHeight} + buffer: ${bufferPx.toFixed(0)})`);
            } else if (targetRect.top < containerRect.top) { // 部分的に上にはみ出てる
              newScrollTop = initialScrollTop - (containerRect.top - targetRect.top); // はみ出てる分だけ上にスクロール
              // console.log(`[FAS] 部分的に上にはみ出ています。 newScrollTop: ${newScrollTop.toFixed(0)} (scrolledBy: ${(containerRect.top - targetRect.top).toFixed(0)})`);
            } else if (targetRect.bottom > containerRect.bottom) { // 部分的に下にはみ出てる
              newScrollTop = initialScrollTop + (targetRect.bottom - containerRect.bottom); // はみ出てる分だけ下にスクロール
              // console.log(`[FAS] 部分的に下にはみ出ています。 newScrollTop: ${newScrollTop.toFixed(0)} (scrolledBy: ${(targetRect.bottom - containerRect.bottom).toFixed(0)})`);
            } else {
              // 部分的に見えてる場合は、何もしない (または、もっと穏やかな調整をする？ 今回はまず何もしないで様子見！)
              // console.log(`[FAS] アイテムは表示範囲内です。スクロール調整は行いません。`);
            }

            // newScrollTop が負の値や、最大スクロール量を超えないように調整
            const maxScroll = resultsContainer.scrollHeight - resultsContainer.clientHeight;
            newScrollTop = Math.max(0, Math.min(newScrollTop, maxScroll < 0 ? 0 : maxScroll)); // maxScrollが負になるケースも考慮

            if (initialScrollTop.toFixed(0) !== newScrollTop.toFixed(0)) { // 比較も小数点以下を揃えてみる
              // console.log(`[FAS] scrollTop を ${initialScrollTop.toFixed(0)} から ${newScrollTop.toFixed(0)} に変更します。`);
              resultsContainer.scrollTop = newScrollTop;
            } else {
              // console.log(`[FAS] scrollTop (${initialScrollTop.toFixed(0)}) は変更されませんでした (計算結果: ${newScrollTop.toFixed(0)})。`);
            }
          }
          // console.log(`やった！アイテム ${selectedIndex} にフォーカス＆スクロールできたよ！ (リトライ ${i} 回)`);
          return;
        }
      }
      // ★★★ ブラウザのおせっかい対策！ ★★★
      // リトライしても要素が見つからなかった場合でも、scrollTop が意図せず変わってたら元に戻す！
      if (resultsContainer && resultsContainer.scrollTop !== scrollTopBeforeFocusLogic) {
        // console.warn(`[FAS] 要素は見つからなかったけど、scrollTop が ${scrollTopBeforeFocusLogic} から ${resultsContainer.scrollTop} に変わっちゃってたので、元に戻します！`);
        resultsContainer.scrollTop = scrollTopBeforeFocusLogic;
      }
      // console.warn(`(´・ω・｀) しょぼん… リトライ上限に達しちゃったけど、アイテム ${selectedIndex} にフォーカスできなかったよ。 List container:`, resultsContainer);
    }
  }

  async function handleResultKeydown(event: KeyboardEvent, idx: number) { // async を追加！
    // 選択できる最大indexはitemCount-1だよ！
    const maxSelectableIndex = itemCount - 1;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Tab') {
      handleKeydown(event);
    } else if (event.key === 'ArrowLeft') {
      // ←でinput欄に戻る！
      event.preventDefault();
      selectedIndex = -1;
      // tick().then(focusCurrent);
      justFocusedByKeyEvent = true;
      await ensureSelectedItemVisibleAndFocused(true, true);
    } else if (event.key === 'ArrowRight') {
      // →でリストの最下層（最後の候補）へ！
      event.preventDefault();
      if (selectedIndex !== maxSelectableIndex) {
        selectedIndex = maxSelectableIndex;
        // tick().then(focusCurrent);
        justFocusedByKeyEvent = true;
        await ensureSelectedItemVisibleAndFocused(true, true);
      }
    } else if (event.key === 'Enter') {
      // フォーカスされている候補を実行する処理！
      // idx は visibleItems の中でのインデックスなので、全体のインデックスに変換！
      const globalIdx = visibleStartIndex + idx;
      if (globalIdx >= 0 && globalIdx < totalResultsCountFromRust) {
        const itemToExecute = getItemByGlobalIndex(globalIdx);
        if (itemToExecute) executeResult(itemToExecute);
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

    // 設定反映をawaitするためasync化
    const applyInitialSettings = async (settings: WindowSettings | null) => {
      const currentAppWindow = WebviewWindow.getCurrent();
      const promises: Promise<any>[] = [];
      if (settings) {
        if (settings.width !== undefined) currentWindowWidth = settings.width;
        if (settings.x !== undefined && settings.y !== undefined) {
          currentWindowX = settings.x;
          currentWindowY = settings.y;
          promises.push(currentAppWindow.setPosition(new PhysicalPosition(settings.x, settings.y)));
        }
        if (settings.opacity !== undefined) {
          currentOpacity = settings.opacity;
        }
        if (settings.displayLimit !== undefined) {
          displayLimit = settings.displayLimit;
        } else {
          displayLimit = -1;
        }
      }
      // currentWindowWidthが未定義なら今のウィンドウ幅を取得
      if (currentWindowWidth === undefined) {
        promises.push(currentAppWindow.innerSize().then(size => { currentWindowWidth = size.width; }));
      }
      await Promise.all(promises);
      console.log('適用する設定だよ！:', JSON.stringify(settings), `幅: ${currentWindowWidth}, X: ${currentWindowX}, Y: ${currentWindowY}, 透明度: ${currentOpacity}, 表示上限: ${displayLimit}`);
    };

    // Rustくんから設定を読み込むよ！ (∩ˊ꒳​ˋ∩)･*
    invoke<WindowSettings>('load_window_settings')
      .then(async settings => {
        console.log('やったー！設定が届いたよ！ ☆<em>:.｡. o(≧▽≦)o .｡.:</em>☆', settings);
        await applyInitialSettings(settings);
        initialSettingsError = null;
      })
      .catch(async err => {
        console.error('うにゃ～ん、設定読み込みでエラーだって… (´；ω；｀)', err);
        initialSettingsError = String(err); // エラーオブジェクトを文字列に変換するね！
        await applyInitialSettings({ width: 500, opacity: 1.0 }); // 仮のデフォルト値だよ！
      })
      .finally(async () => {
        settingsApplied = true;
        // 設定反映後にウィンドウを表示するよ！
        console.log('いよいよウィンドウを表示するよ！ settingsApplied:', settingsApplied);
        const currentAppWindow = WebviewWindow.getCurrent();
        await currentAppWindow.show().then(() => {
          console.log('やったー！show() の魔法、成功したみたい！ (≧∇≦)b');
          currentAppWindow.isVisible().then(visible => {
            console.log('ウィンドウは見えるはず…？ isVisible:', visible);
          });
          currentAppWindow.setFocus();
        }).catch(err => {
          console.error('うにゃーん、show() の魔法でエラーが出ちゃった… (´；ω；｀)', err);
        });
      });

    const currentAppWindow = WebviewWindow.getCurrent();
    currentAppWindow.outerPosition().then(pos => {
      console.log('Initial window outer position:', pos);
    });
    currentAppWindow.innerSize().then(size => {
      console.log('Initial window inner size:', size);
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
        event.preventDefault(); // ページがスクロールしちゃうのを防ぐ！えらい！
        const deltaY = event.deltaY > 0 ? -0.05 : 0.05; // ホイールの向きで変えるよ！
        let newOpacity = Math.max(0.1, Math.min(1.0, currentOpacity + deltaY)); // 0.1～1.0の間にする！
        newOpacity = parseFloat(newOpacity.toFixed(2)); // 小数点以下2桁にしとこ！
        currentOpacity = newOpacity;
        console.log(`currentOpacity updated to: ${currentOpacity}, saving...`);
        invoke('save_window_settings', { settings: { width: currentWindowWidth, x: currentWindowX, y: currentWindowY, opacity: currentOpacity } });
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    
    currentAppWindow.onResized(({ payload: size }) => {
      currentWindowWidth = size.width;
      invoke('save_window_settings', { settings: { width: currentWindowWidth, x: currentWindowX, y: currentWindowY, opacity: currentOpacity } });
    }).then(unlistener => {
      unlistenResizedFn = unlistener;
    });

    currentAppWindow.onMoved(({ payload: position }) => {
      currentWindowX = position.x;
      currentWindowY = position.y;
      invoke('save_window_settings', { settings: { width: currentWindowWidth, x: currentWindowX, y: currentWindowY, opacity: currentOpacity } });
    }).then(unlistener => {
      unlistenMovedFn = unlistener;
    });

    return () => { // コンポーネントが消えるときに、イベントリスナーもちゃんとお片付け！偉い！ (<em>´ω｀</em>)
      window.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('wheel', handleWheel);
      if (unlistenResizedFn) unlistenResizedFn();
      if (unlistenMovedFn) unlistenMovedFn();
    };
  });

  // --- 高さ調整のリアクティブブロック ---
  $: {
    // itemCountはdisplayLimitを考慮した表示件数！
    // itemCountは下のリアクティブ宣言で管理するのでここでは代入しない！
    let currentTotalHeight = baseHeight;
    let actualMessageHeight = 0;
    if (message) actualMessageHeight += messageLineHeight;
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
      listVisibleHeight = Math.max(0, Math.min(itemsSectionTargetHeight, availableHeightForList));
    } else {
      listVisibleHeight = 0;
    }
    if (typeof window !== 'undefined' && currentWindowWidth !== undefined && settingsApplied) {
      const currentAppWindow = WebviewWindow.getCurrent();
      currentAppWindow.setSize(new PhysicalSize(currentWindowWidth, finalWindowHeight)).catch(() => {});
    }
  }

  let scrollTimeout: number; // デバウンス用のタイマーIDをしまう変数だよ！
  // スクロールイベントのハンドラだよ！
  function handleScroll(event: Event) {
    if (isLoadingMore) return; // 読み込み中は新しい要求をしない！

    const target = event.target as HTMLElement;
    const scrollTop = target.scrollTop;
    const clientHeight = target.clientHeight;

    // --- スクロールイベントのデバウンス処理！ ---
    clearTimeout(scrollTimeout);
    scrollTimeout = window.setTimeout(() => {
      if (totalResultsCountFromRust === 0) return; // itemHeightのチェックは不要なので削除！ まだ準備できてなかったら何もしない！

      // 表示領域の真ん中に来るべきアイテムの、全体のインデックスを計算するよ！
      const middleVisibleGlobalIndex = Math.floor((scrollTop + clientHeight / 2) / itemHeight);

      // 1つの表示ウィンドウで読み込むアイテムの数 (画面に見える数 + 上下バッファ)
      const windowItemCount = (itemsToRenderInView > 0 ? itemsToRenderInView : INITIAL_ITEMS_TO_LOAD) + RENDER_BUFFER_ITEMS * 2;
      
      // 新しい表示ウィンドウの開始インデックスを計算するよ！
      // middleVisibleGlobalIndex がウィンドウの中心あたりに来るように調整！
      let newFetchStartIndex = Math.max(0, middleVisibleGlobalIndex - Math.floor(windowItemCount / 2));
      // ただし、最後まで表示しきれるように、末尾でのはみ出しも調整！ (ensureSelectedItemVisibleAndFocused と同じロジックに！)
      // (totalResultsCountFromRust - windowItemCount) がマイナスになる場合も考慮して Math.max(0, ...) を入れる！
      newFetchStartIndex = Math.min(newFetchStartIndex, Math.max(0, totalResultsCountFromRust - windowItemCount));
      // 念のため、0未満にならないように！
      newFetchStartIndex = Math.max(0, newFetchStartIndex);

      // もし、計算した新しい開始位置が、今の開始位置と全く同じだったら、何もしないよ！
      if (newFetchStartIndex === visibleStartIndex && visibleItems.length > 0) {
        // console.log(`新しい開始位置 (${newFetchStartIndex}) が今の開始位置 (${visibleStartIndex}) と同じなので、何もしないよ！`);
        return;
      }

      // 今表示してる範囲 (visibleStartIndex) と、新しく計算した開始位置 (newFetchStartIndex) が
      // あんまり変わらなかったら (例えば、表示されてるアイテム数の半分もズレてなかったら)、
      // わざわざ再読み込みしなくてもいいかもね！っていうヒステリシス処理だよ！ (<em>´ω｀</em>)
      const changeThreshold = Math.max(1, Math.floor((itemsToRenderInView > 0 ? itemsToRenderInView : INITIAL_ITEMS_TO_LOAD) / 4)); // 1/4画面分くらい
      if (Math.abs(newFetchStartIndex - visibleStartIndex) < changeThreshold && visibleItems.length > 0) {
        // console.log(`スクロール位置は今の表示範囲 (${visibleStartIndex}-${visibleStartIndex+visibleItems.length}) に近い (計算結果: ${newFetchStartIndex}) ので、今回は何もしないよ！`);
        return;
      }
      
      console.log(`スクロールで新しい範囲を要求するよ！ scrollTop:${scrollTop.toFixed(0)}, middleGlobalIndex:${middleVisibleGlobalIndex}, newFetchStartIndex:${newFetchStartIndex}, windowItemCount:${windowItemCount}`);
      fetchItems(newFetchStartIndex, windowItemCount);
    }, 50); // 50ミリ秒待ってから処理するよ！ (この時間はお好みで調整してね！)
  }

  // itemCountはSvelteのリアクティブ変数として宣言！
  // これからは、Rustが教えてくれた総件数 (totalResultsCountFromRust) を元に計算するよ！
  $: itemCount = displayLimit === -1 ? totalResultsCountFromRust : Math.min(totalResultsCountFromRust, displayLimit);

  $: if (visibleItems.length === 0 && totalResultsCountFromRust === 0) selectedIndex = -1;
</script>

<link href="https://fonts.googleapis.com/css2?family=M+PLUS+1+Code&display=swap" rel="stylesheet">

<main style="background-color: rgba(255, 255, 255, {currentOpacity});">
  <div class="search-container">
    <input
      type="text"
      bind:value={searchTerm}
      bind:this={searchInput}
      on:keydown={handleKeydown}
      placeholder="検索キーワードを入力..."
      aria-label="検索キーワード"
    />
  </div>

  {#if message}
    <p class="message">{message}</p>
  {/if}

  {#if totalResultsCountFromRust > 0}
    <!-- この外側のdivが、全体のスクロール可能な高さを持ち、スクロールイベントをハンドルするよ！ -->
    <div 
      class="results-list-scroll-container" 
      style="height: {listVisibleHeight}px; overflow-y: auto;"
      on:scroll={handleScroll}
    >
      <!-- この内側のdivが、実際に全アイテム分の高さを持つ「見えない」コンテナ！ -->
      <div class="results-list-content" style="height: {totalResultsCountFromRust * itemHeight}px; position: relative;">
        <!-- 表示するアイテム (visibleItems) だけを絶対位置で配置するよ！ -->
        {#each visibleItems as item, localIndex (item.path) }
          {@const globalIndex = visibleStartIndex + localIndex}
          <div
            title={item.path}
            class:selected={selectedIndex === globalIndex}
            class="item"
            role="option"
            aria-selected={selectedIndex === globalIndex ? 'true' : 'false'}
            on:keydown={(e) => handleResultKeydown(e, localIndex)}
            on:click={() => { selectedIndex = globalIndex; executeResult(item); }}
            data-index={globalIndex}
            tabindex={selectedIndex === globalIndex ? 0 : -1}
            style="position: absolute; top: {globalIndex * itemHeight}px; width: 100%;"
          >
            {item.name}
          </div>
        {/each}
      </div>
    </div>
    <!-- overflowMessageText の表示条件も totalResultsCountFromRust を見るように！ -->
    {#if overflowMessageText && totalResultsCountFromRust > displayLimit}
      <p class="overflow-message">{overflowMessageText}</p>
    {/if}
  {/if}
</main>

<style>
  :root {
    --bg: #121212;
    --item-bg: rgba(255, 255, 255, 0.04);
    --item-selected: rgba(255, 255, 255, 0.3);
    --border-color: rgba(255, 255, 255, 0.2);
    --accent: #6c63ff;
    --text-color: #333333;
  }
  :global(html), :global(body) {
    overflow: hidden; /* ウィンドウ全体のスクロールバーはバイバイ！ (´；ω；｀)ﾉｼ */
    height: 100%;
    background: transparent !important; /* htmlの背景も透明にな～れ！ (人∀・)ﾀﾉﾑ */
    margin: 0;
    padding: 0;
    font-family: 'M PLUS 1 Code', monospace;
    font-weight: bold;
  }
  main {
    text-align: center;
    margin: 0 auto;
    padding: 0.5em 0.25em;
    display: flex;
    flex-direction: column;
    height: 100vh;
    /* background-color: transparent !important; */ /* インラインスタイルで背景色と透明度を設定するよ！ */
    box-sizing: border-box; /* パディングとかボーダーも高さに含めるよ！ */
  }
  .search-container {
    display: inline-block;
    margin-top: 0.25em;
    vertical-align: middle;
    text-align: left;
    background-color: transparent; /* 検索コンテナも透明に！ */
  }

  input {
    flex-grow: 1;
    padding: 0.3em 0.5em;
    line-height: normal; /* これで上下のバランスが良くなるかも！ */
    font-size: 1em; /* フォントサイズもちゃんと指定しとこ！ */
    border: none; /* 枠線、バイバイ！ (´；ω；｀)ﾉｼ */
    outline: none; /* フォーカスしたときの枠線も消しちゃえ！ */
    background-color: transparent; /* 入力欄も透明にな～れ！ */
    width: -webkit-fill-available; /* 幅の最大化 */
    min-width: 0; /* これがないと fill-available が効かないことがあるらしい？ */
    font-family: inherit;
    color: var(--text-color); /* 入力文字の色も忘れずに！ */
  }
  input::placeholder {
    color: #aaa; /* プレースホルダーの色もちょっと調整！ */
    opacity: 0.7;
  }
  .message {
    color: #555;
    margin: 0.25em 0;
    background-color: transparent; /* メッセージも透明に！ */
  }
  .results-list {
    /* このクラス名はもう使わないので、スタイルは results-list-scroll-container に移すか、
       results-list-scroll-container のスタイルをここに書く！ */
    padding: 0; /* ←パディングを0にしてズレを防ぐ！ */
    text-align: left;
    background-color: transparent;
    /* スクロールバーを非表示にする魔法！ ✨ */
    /* Webkit系 (Chrome, Safariなど) */
    &::-webkit-scrollbar {
      display: none;
    }
    /* Firefox */
    scrollbar-width: none;
    /* IE and Edge (一応ね！) */
    -ms-overflow-style: none;
    /* overflow-y: auto; */ /* ← インラインスタイルで設定するようにしたよ！ */
  }
  .results-list-scroll-container { /* 新しいスクロールコンテナ用のスタイル！ */
    list-style: none;
    padding: 0;
    text-align: left;
    background-color: transparent;
    &::-webkit-scrollbar { display: none; }
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .results-list-content {
    /* この子自体には特別なスタイルはあまりいらないかも？
       position: relative; はインラインで設定済み！ */
  }
  /* svelte-virtual を使わなくなったので、この :global はもういらないかも？ */
  /* :global(.results-list > div) {
    overflow: hidden !important;
  } */
  .item:last-child { border-bottom: none; }
  .item.selected {
    outline: 2px solid var(--item-selected); /* outlineに戻すよ！ */
    outline-offset: -2px; /* そして、アウトラインを2px内側にオフセット！これでどうだ！ ✨ */
  }
  .item {
    font-family: var(--font-main);
    height: 35px; /* ←itemHeightと完全一致させる！ */
    display: flex;
    align-items: center;
    padding: 0 0.5em; /* 横だけパディング */
    background-color: var(--item-bg);
    color: var(--text-color);
    border-radius: 4px;
    transition: background-color 0.2s ease, transform 0.1s ease;
    border: 1px solid transparent;
    margin-left: 3px; /* 左右の余白を均等に近づける！ */
    margin-right: 3px; /* 右にも同じだけ余白を追加！ */
    box-sizing: border-box;
  }
  .item.selected {
    background-color: var(--item-selected);
    border-color: var(--border-color);
    transform: scale(1.02);
  }
  .overflow-message {
    color: #888;
    font-size: 0.9em;
    margin: 0.25em 0;
    background-color: transparent; /* はみだしメッセージも透明に！ */
  }
</style>
