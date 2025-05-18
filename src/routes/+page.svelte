<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { PhysicalSize, PhysicalPosition } from '@tauri-apps/api/window';
  import { invoke } from '@tauri-apps/api/core';
  import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { searchFiles, type SearchResult } from '../lib/searcher';
  import { List } from 'svelte-virtual'; // ←正しいimportはList！

  let searchInput: HTMLInputElement; // input要素を後でつかまえるためのおてて！
  let searchTerm: string = '';
  let message: string = '';

  let searchResults: SearchResult[] = []; // 検索結果をここにしまうよ！ (<em>´ω｀</em>)
  let displayLimit: number = -1; // デフォルトは無制限！
  let overflowMessageText = ''; // 上限を超えたときに出すメッセージ！

  let selectedIndex: number = -1; // -1はinput欄、0～は候補リストのインデックス！
  let listRef: any; // Listコンポーネントの参照（型はanyでOK）
  let listContainerElement: HTMLElement; // Listコンポーネントのコンテナ要素を保持するよ！

  // ウィンドウの高さ調整のための定数だよ！ (｡•̀ω-)b
  const baseHeight = 50; // 入力欄とかパディングとかの基本的な高さ！
  const itemHeight = 35; // 検索結果1件あたりのだいたいの高さ！
  const messageLineHeight = 25; // メッセージ1行あたりのだいたいの高さ！
  const maxHeight = 400; // これ以上は大きくならないようにする上限！
  let currentWindowWidth: number | undefined = undefined;
  let currentWindowX: number | undefined = undefined;
  let currentWindowY: number | undefined = undefined;
  let currentOpacity: number = 1.0; // ウィンドウの透明度だよ！最初はくっきり！

  let settingsApplied = false; // 設定が適用されたかな？ (<em>´ω｀</em>)
  let initialSettingsError: string | null = null; // 設定読み込みでエラーが出ちゃった？
  let listVisibleHeight: number = 0; // Listコンポーネントの実際の表示高さ！

  interface WindowSettings {
    width?: number;
    x?: number;
    y?: number;
    opacity?: number;
    displayLimit?: number; // 追加！
  }

  async function handleSearch() { // searchFilesちゃんは非同期だから async をつけるよ！
    message = ''; // メッセージを一旦消しとこ！
    if (searchTerm.trim() === '') {
      message = '何か入力してね！ (｡•́︿•̀｡)';
      searchResults = [];
    } else {
      try {
        console.log(`Searching for: "${searchTerm}"`);
        searchResults = await searchFiles(searchTerm); // searchFilesちゃんにお願い！
        console.log(`Found ${searchResults.length} results.`);
        if (searchResults.length === 0) {
          message = `「${searchTerm}」は見つからなかったよ… (´・ω・｀)`;
        }
      } catch (error) {
        console.error('Search failed:', error);
        message = `検索中にエラーが起きちゃった… (´；ω；｀) ${error}`;
        searchResults = [];
      }
    }
    // 検索結果の数に応じてオーバーフローメッセージを更新するよ！
    if (displayLimit !== -1 && searchResults.length > displayLimit) {
      overflowMessageText = `他にも ${searchResults.length - displayLimit} 件あるよ！ もっと絞り込んでね！ (ゝ∀･)⌒☆`;
    } else {
      overflowMessageText = '';
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (searchResults.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (selectedIndex < searchResults.length - 1) { // 表示上限に関わらず、全結果を移動できるようにするよ！
          selectedIndex++;
        } else {
          selectedIndex = -1; // input欄に戻る
        }
        focusCurrent();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (selectedIndex === -1 && searchResults.length > 0) { // 検索結果がある場合のみ
          selectedIndex = searchResults.length - 1; // 一番下にジャンプ！
        } else if (selectedIndex > 0) { // 既にリスト選択中の場合
          selectedIndex--;
        } else { // selectedIndex が 0 のときや、検索結果がないとき
          selectedIndex = -1; // input欄に戻る
        }
        focusCurrent();
      } else if (event.key === 'Tab') {
        if (!event.shiftKey && selectedIndex === -1 && searchResults.length > 0) {
          event.preventDefault();
          selectedIndex = 0;
          focusCurrent();
        } else if (event.shiftKey && selectedIndex === 0) {
          event.preventDefault();
          selectedIndex = -1;
          focusCurrent();
        }
      } else if (event.key === 'Enter') {
        if (selectedIndex >= 0 && selectedIndex < searchResults.length) { // 表示上限に関わらず、選択できるようにするよ！
          // ここで候補を選択したときのアクションを書くよ！
          // 例: alert(`選択: ${searchResults[selectedIndex].name}`);
          // TODO: 実際のアクションに置き換えてね！
        } else {
          handleSearch();
        }
      }
    } else if (event.key === 'Enter') {
      handleSearch();
    }
  }

  function focusCurrent() {
    if (selectedIndex === -1) {
      searchInput?.focus();
    } else {
      // svelte-virtual の List は scrollTo.index だよ！
      if (listRef && listRef.scrollTo && typeof listRef.scrollTo.index === 'function' && searchResults[selectedIndex]) {
        listRef.scrollTo.index(selectedIndex, { behavior: 'smooth', alignment: 'auto' });
        tick().then(() => { // SvelteのDOM更新を待つよ！
          requestAnimationFrame(() => { // ブラウザの次の描画フレームを待つよ！
            if (listContainerElement) { // コンテナ要素がちゃんと取れてるかな？
              const targetElement = listContainerElement.querySelector(`div[data-index="${selectedIndex}"]`) as HTMLDivElement | null;
              targetElement?.focus();
              console.log('[Debug] Attempted scrollTo.index and focus for item:', selectedIndex, targetElement);
            } else {
              console.warn('[Debug] listContainerElement is not available when trying to focus.');
            }
          });
        });
      } else {
        console.warn('[Debug] listRef.scrollTo.index is not available or item is missing. Falling back or logging error.');
      }
    }
  }

  function handleResultKeydown(event: KeyboardEvent, idx: number) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Tab') {
      handleKeydown(event);
    } else if (event.key === 'Enter') {
      // ここで候補を選択したときのアクションを書くよ！
      // 例: alert(`選択: ${searchResults[idx].name}`);
      // TODO: 実際のアクションに置き換えてね！
    }
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

  // 表示内容が変わったら、ウィンドウの高さを調整するよ！ (∩ˊ꒳​ˋ∩)･*
  $: {
    let currentTotalHeight = baseHeight; // まずは基本の高さからスタート！
    // 「見つからなかった…」メッセージが表示されるかどうかのチェック！ (｡•̀ω-)b
    const noResultsMessageVisible = searchTerm.trim() !== '' && searchResults.length === 0 && message.includes("見つからなかった");

    let actualMessageHeight = 0; // メッセージエリアが実際に取る高さ！
    if (message) { // 「何か入力してね！」のメッセージ
      actualMessageHeight += messageLineHeight;
    }
    // noResultsMessageVisible のための高さは、message に「見つからなかった」が含まれるので、上の if(message) でカバーされるよ！

    let itemsSectionTargetHeight = 0; // 検索結果リストが本来取りたい高さ！
    if (searchResults.length > 0) {
      itemsSectionTargetHeight = Math.min(searchResults.length, displayLimit === -1 ? searchResults.length : displayLimit) * itemHeight;
      if (overflowMessageText) { // overflowMessage はリストがあるときだけ表示されるから、その分の高さも追加！
        actualMessageHeight += messageLineHeight;
      }
    }
    currentTotalHeight += actualMessageHeight; // メッセージの高さを加算！
    currentTotalHeight += itemsSectionTargetHeight; // リストの高さを加算！

    // ウィンドウの高さは、計算された合計か基本の高さの大きい方で、かつ上限を超えないように！
    const finalWindowHeight = Math.min(Math.max(currentTotalHeight, baseHeight), maxHeight);

    if (searchResults.length > 0) {
      // リストが表示される場合、リスト部分が実際に使える高さを計算するよ！
      let nonListHeight = baseHeight; // リスト以外の部分の高さ
      if (message && !message.includes("見つからなかった")) { // 「見つからなかった」以外のメッセージ（リストと共存する可能性あり）
        nonListHeight += messageLineHeight;
      }
      if (overflowMessageText) { // overflowMessageもリストと共存するね！
        nonListHeight += messageLineHeight;
      }
      // リストが使えるのは、ウィンドウ全体の高さからこれらの要素を引いた残り！
      let availableHeightForList = finalWindowHeight - nonListHeight;
      // 実際にリストに割り当てる高さは、使える高さとリストが取りたい高さの小さい方。ただし0未満にはならないように！
      listVisibleHeight = Math.max(0, Math.min(itemsSectionTargetHeight, availableHeightForList));
    } else {
      listVisibleHeight = 0; // 検索結果がなければリストの高さは0！
    }

    if (typeof window !== 'undefined' && currentWindowWidth !== undefined && settingsApplied) { // settingsApplied のチェックを追加！
      console.log(`Reactive block triggered. currentWindowWidth: ${currentWindowWidth}, finalWindowHeight: ${finalWindowHeight}, listVisibleHeight: ${listVisibleHeight}`);
      const currentAppWindow = WebviewWindow.getCurrent();
      currentAppWindow.setSize(new PhysicalSize(currentWindowWidth, finalWindowHeight))
        .then(() => console.log('setSize succeeded!'))
        .catch(err => console.error('setSize failed:', err));
    }
  }

  $: if (searchResults.length === 0) selectedIndex = -1;
</script>

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

  {#if searchResults.length > 0}
    <div class="results-list">
      <List
        itemCount={searchResults.length}
        itemSize={itemHeight}
        height={listVisibleHeight}
        bind:this={listRef}
        bind:containerElement={listContainerElement}
      >
        {#snippet item({ index })}
          <div
            title={searchResults[index]?.path}
            class:selected={selectedIndex === index}
            class="results-list-item"
            role="option"
            aria-selected={selectedIndex === index ? 'true' : 'false'}
            on:keydown={(e) => handleResultKeydown(e, index)}
            on:click={() => { selectedIndex = index; /* TODO: 実際のアクション */ }}
            data-index={index}
            tabindex={selectedIndex === index ? 0 : -1}
          >
            {searchResults[index]?.name}
          </div>
        {/snippet}
      </List>
    </div>
    {#if overflowMessageText}
      <p class="overflow-message">{overflowMessageText}</p>
    {/if}
  {/if}
</main>

<style>
  :global(html), :global(body) {
    overflow: hidden; /* ウィンドウ全体のスクロールバーはバイバイ！ (´；ω；｀)ﾉｼ */
    height: 100%;
    background: transparent !important; /* htmlの背景も透明にな～れ！ (人∀・)ﾀﾉﾑ */
    margin: 0;
    padding: 0;
    font-family: Unispace;
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
    border: none; /* 枠線、バイバーイ！ (´；ω；｀)ﾉｼ */
    outline: none; /* フォーカスしたときの枠線も消しちゃえ！ */
    background-color: transparent; /* 入力欄も透明にな～れ！ */
    width: -webkit-fill-available; /* 幅の最大化 */
    font-family: inherit;
  }
  .message {
    color: #555;
    margin: 0.25em 0;
    background-color: transparent; /* メッセージも透明に！ */
  }
  .results-list {
    list-style: none;
    padding: 2px;
    text-align: left;
    background-color: transparent;
  }
  .results-list-item {
    padding: 0.3em 0.5em;
    border-bottom: 1px solid #eee;
    background-color: transparent;
    outline: none;
  }
  .results-list-item:last-child { border-bottom: none; }
  .results-list-item.selected {
    background: #d0eaff;
    color: #007acc;
    font-weight: bold;
    border-radius: 4px;
    outline: 2px solid #007acc;
  }
  .overflow-message {
    color: #888;
    font-size: 0.9em;
    margin: 0.25em 0;
    background-color: transparent; /* はみだしメッセージも透明に！ */
  }
</style>
