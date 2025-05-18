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
        if (selectedIndex < searchResults.length - 1) {
          selectedIndex++;
        } else {
          selectedIndex = -1;
        }
        tick().then(async () => {
          await focusCurrent();
        });
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (selectedIndex === -1 && searchResults.length > 0) {
          selectedIndex = searchResults.length - 1;
        } else if (selectedIndex > 0) {
          selectedIndex--;
        } else {
          selectedIndex = -1;
        }
        tick().then(async () => {
          await focusCurrent();
        });
      } else if (event.key === 'Tab') {
        if (!event.shiftKey && selectedIndex === -1 && searchResults.length > 0) {
          event.preventDefault();
          selectedIndex = 0;
          tick().then(async () => {
            await focusCurrent();
          });
        } else if (event.shiftKey && selectedIndex === 0) {
          event.preventDefault();
          selectedIndex = -1;
          tick().then(async () => {
            await focusCurrent();
          });
        }
      } else if (event.key === 'Enter') {
        if (selectedIndex >= 0 && selectedIndex < searchResults.length) {
          // フォーカスされている候補を実行する処理！
          executeResult(searchResults[selectedIndex]);
        } else {
          handleSearch();
        }
      }
    } else if (event.key === 'Enter') {
      handleSearch();
    }
  }

  async function focusCurrent() { // async関数にするよ！ (｀・ω・´)ゞ
    if (selectedIndex === -1) {
      searchInput?.focus();
      return;
    } else if (listRef && listRef.scrollTo && typeof listRef.scrollTo.index === 'function' && searchResults[selectedIndex]) {
      listRef.scrollTo.index(selectedIndex, { behavior: 'smooth', alignment: 'auto' });
      for (let i = 0; i < 25; i++) {
        await tick();
        await new Promise(resolve => requestAnimationFrame(resolve));
        let container: HTMLElement | null = null;
        if (typeof listRef.getContainer === 'function') {
          container = listRef.getContainer();
        } else if (listRef instanceof HTMLElement) {
          container = listRef;
        }
        if (container) {
          const targetElement = container.querySelector(`div[data-index="${selectedIndex}"]`) as HTMLDivElement | null;
          if (targetElement) {
            targetElement.focus();
            // フォーカスできたらreturn！警告は出さない！
            return;
          }
        }
      }
      // フォーカスできなかった場合でも警告は出さない！
      // （実行自体はできてるのでノイズは出さないよ！）
    }
  }

  function handleResultKeydown(event: KeyboardEvent, idx: number) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Tab') {
      handleKeydown(event);
    } else if (event.key === 'Enter') {
      // フォーカスされている候補を実行する処理！
      executeResult(searchResults[idx]);
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
    let currentTotalHeight = baseHeight;
    let actualMessageHeight = 0;
    if (message) actualMessageHeight += messageLineHeight;
    let itemsSectionTargetHeight = 0;
    if (searchResults.length > 0) {
      itemsSectionTargetHeight = Math.min(searchResults.length, displayLimit === -1 ? searchResults.length : displayLimit) * itemHeight;
      if (overflowMessageText) actualMessageHeight += messageLineHeight;
    }
    currentTotalHeight += actualMessageHeight + itemsSectionTargetHeight;
    const finalWindowHeight = Math.min(Math.max(currentTotalHeight, baseHeight), maxHeight);
    if (searchResults.length > 0) {
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

  $: if (searchResults.length === 0) selectedIndex = -1;
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

  {#if searchResults.length > 0}
    <div class="results-list">
      <List
        itemCount={searchResults.length}
        itemSize={itemHeight}
        height={listVisibleHeight}
        bind:this={listRef}
      >
        {#snippet item({ index })}
          <div
            title={searchResults[index]?.path}
            class:selected={selectedIndex === index}
            class="item"
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
    font-family: inherit;
  }
  .message {
    color: #555;
    margin: 0.25em 0;
    background-color: transparent; /* メッセージも透明に！ */
  }
  .results-list {
    list-style: none;
    padding: 0; /* ←パディングを0にしてズレを防ぐ！ */
    text-align: left;
    background-color: transparent;
  }
  :global(.results-list > div) {
    overflow: hidden !important;
  }
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
