<script lang="ts">
  import { onMount } from 'svelte';
  import { PhysicalSize, PhysicalPosition } from '@tauri-apps/api/window';
  import { invoke } from '@tauri-apps/api/core';
  import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { searchFiles, type SearchResult } from '../lib/searcher'; // Windows Searchの魔法を借りてくるよ！

  let searchInput: HTMLInputElement; // input要素を後でつかまえるためのおてて！
  let searchTerm: string = '';
  let message: string = '';

  let searchResults: SearchResult[] = []; // 検索結果をここにしまうよ！ (<em>´ω｀</em>)
  const displayLimit = 5; // 一度に表示する候補の上限だよ！
  let overflowMessageText = ''; // 上限を超えたときに出すメッセージ！

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

  interface WindowSettings {
    width?: number;
    x?: number;
    y?: number;
    opacity?: number;
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
    if (searchResults.length > displayLimit) {
      overflowMessageText = `他にも ${searchResults.length - displayLimit} 件あるよ！ もっと絞り込んでね！ (ゝ∀･)⌒☆`;
    } else {
      overflowMessageText = '';
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      handleSearch();
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
          // setOpacityはTauri v2には存在しないため、ここではCSSで反映するのみ
        }
      }
      // currentWindowWidthが未定義なら今のウィンドウ幅を取得
      if (currentWindowWidth === undefined) {
        promises.push(currentAppWindow.innerSize().then(size => { currentWindowWidth = size.width; }));
      }
      await Promise.all(promises);
      console.log('適用する設定だよ！:', JSON.stringify(settings), `幅: ${currentWindowWidth}, X: ${currentWindowX}, Y: ${currentWindowY}, 透明度: ${currentOpacity}`);
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
        const delta = event.deltaY > 0 ? -0.05 : 0.05; // ホイールの向きで変えるよ！
        let newOpacity = Math.max(0.1, Math.min(1.0, currentOpacity + delta)); // 0.1～1.0の間にする！
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
    let newHeight = baseHeight;
    // 「見つからなかった…」メッセージが表示されるかどうかのチェック！ (｡•̀ω-)b
    const noResultsMessageVisible = searchTerm.trim() !== '' && searchResults.length === 0 && message.includes("見つからなかった");

    if (message) { // 「何か入力してね！」のメッセージ
      newHeight += messageLineHeight; // とりあえず1行分ってことにしとこ！
    }
    if (searchResults.length > 0) {
      newHeight += Math.min(searchResults.length, displayLimit) * itemHeight; // 表示する分だけ！
    }
    if (noResultsMessageVisible) { // 「見つからなかった」メッセージも高さを計算に入れるよ！
      newHeight += messageLineHeight;
    }
    if (overflowMessageText) {
      newHeight += messageLineHeight;
    }

    // 上限を超えないように、でも基本の高さよりは小さくならないように！
    newHeight = Math.min(Math.max(newHeight, baseHeight), maxHeight);

    if (typeof window !== 'undefined' && currentWindowWidth !== undefined) {
      console.log(`Reactive block triggered. currentWindowWidth: ${currentWindowWidth}, newHeight: ${newHeight}`);
      const currentAppWindow = WebviewWindow.getCurrent();
      console.log(`Attempting to setSize: width=${currentWindowWidth}, height=${newHeight}`);
      currentAppWindow.setSize(new PhysicalSize(currentWindowWidth, newHeight))
        .then(() => console.log('setSize succeeded!'))
        .catch(err => console.error('setSize failed:', err));
    }
  }
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
    <ul class="results-list">
      {#each searchResults.slice(0, displayLimit) as result (result.path)}
        <li title={result.path}>{result.name}</li>
      {/each}
    </ul>
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
    padding: 0;
    margin: 0 0 0.5em 0;
    text-align: left;
    overflow-y: hidden; /* スクロールバーも隠しちゃえ！ */
    background-color: transparent; /* 結果リストの背景も透明に！ */
  }
  .results-list li {
    padding: 0.3em 0.5em;
    border-bottom: 1px solid #eee;
    background-color: transparent; /* リストの項目も透明に！ */
  }
  .results-list li:last-child { border-bottom: none; }
  .overflow-message {
    color: #888;
    font-size: 0.9em;
    margin: 0.25em 0;
    background-color: transparent; /* はみだしメッセージも透明に！ */
  }
</style>
