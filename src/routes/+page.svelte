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


    // 呪文書を読み込んで、ウィンドウの大きさと場所をセットするよ！ (∩ˊ꒳​ˋ∩)･*
    invoke<WindowSettings | null>('load_window_settings')
      .then(settings => {
        console.log('Attempting to load settings from Rust...');
        if (settings) {
          console.log('Loaded settings from Rust:', settings);
          if (settings.width !== undefined) {
            console.log(`Applying width from settings: ${settings.width}`);
            currentWindowWidth = settings.width;
            // 高さは今の計算結果を使うから、幅だけ設定するよ！
            // setSizeは下の $: ブロックで呼ばれるから、ここでは currentWindowWidth の更新だけ！
          }
          if (settings.x !== undefined && settings.y !== undefined) {
            console.log(`Applying position from settings: x=${settings.x}, y=${settings.y}`);
            currentWindowX = settings.x;
            currentWindowY = settings.y;
            currentAppWindow.setPosition(new PhysicalPosition(settings.x, settings.y));
          }
          if (settings.opacity !== undefined) {
            console.log(`Applying opacity from settings: ${settings.opacity}`);
            currentOpacity = settings.opacity;
          }
        } else {
          // 設定がなかったら、今の幅を覚えておくよ！
          console.log('No settings found in Rust, or settings were null. Using current window properties.');
          currentAppWindow.innerSize().then(size => {
            currentWindowWidth = size.width;
          });
          currentAppWindow.outerPosition().then(pos => {
            currentWindowX = pos.x;
            currentWindowY = pos.y;
          });
        }
      })
      .catch(err => {
        console.error('Failed to load window settings:', err);
        // エラーでも、今の幅と位置を覚えておく！
        currentAppWindow.innerSize().then(size => { currentWindowWidth = size.width; });
        currentAppWindow.outerPosition().then(pos => { currentWindowX = pos.x; currentWindowY = pos.y; });
      });

    const unlistenResized = currentAppWindow.onResized(({ payload: size }) => {
      currentWindowWidth = size.width;
      invoke('save_window_settings', { settings: { width: currentWindowWidth, x: currentWindowX, y: currentWindowY, opacity: currentOpacity } });
    });
    const unlistenMoved = currentAppWindow.onMoved(({ payload: position }) => {
      currentWindowX = position.x;
      currentWindowY = position.y;
      invoke('save_window_settings', { settings: { width: currentWindowWidth, x: currentWindowX, y: currentWindowY, opacity: currentOpacity } });
    });

    return () => { // コンポーネントが消えるときに、イベントリスナーもちゃんとお片付け！偉い！ (<em>´ω｀</em>)
      window.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('wheel', handleWheel);
      unlistenResized.then(f => f());
      unlistenMoved.then(f => f());
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
  {#if searchTerm.trim() !== '' && searchResults.length === 0 && message.includes("見つからなかった")}
    <p class="message">「${searchTerm}」に合うもの、見つからなかった… (´・ω・｀)</p>
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
