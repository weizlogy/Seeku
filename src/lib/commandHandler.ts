/**
 * コマンド処理を担当するモジュールだよ！
 */

// コマンドごとの処理を関数に切り出すよ！
// こうすることで、handleCommand関数がスッキリするし、
// 各コマンドの処理内容も分かりやすくなるんだ (o^-')b

/**
 * ヘルプコマンドを処理するよ！
 * @param setMessage 画面にメッセージを表示するための関数
 */
function handleHelpCommand(setMessage: (msg: string) => void): void {
  setMessage(
    `Seeku の使い方ヘルプだよ！ (≧∇≦)ﾉ\n` +
    `--------------------------------------\n` +
    `【基本的な使い方】\n` +
    `・文字を入力して Enter: 検索するよ！\n` +
    `・↑ ↓ キー: 項目を選択できるよ！\n` +
    `・Enter キー (項目選択時): 選択したものを開くよ！\n` +
    `・Ctrl + Enter (項目選択時): 管理者権限で開くよ！ (もし対応していればね！)\n` +
    `・Esc キー: ウィンドウを閉じるよ。\n` +
    `--------------------------------------\n` +
    `【コマンド】\n` +
    `・/help: このヘルプを表示します。\n` +
    `・/bgcolor [色名またはHEXコード]: 背景色を変更します。(例: /bgcolor lightblue, /bgcolor #333333)\n` +
    `・/history: 検索履歴を表示します。\n` +
    `・/history clear: 検索履歴をすべて消去します。\n` +
    `・/opacity [0-100]: ウィンドウの透明度を設定します。\n` +
    `--------------------------------------\n` +
    `【グローバルショートカット】\n` +
    `・Alt + Space: \n` +
    `　ウィンドウの表示/非表示を切り替えるよ！\n` +
    `--------------------------------------\n` +
    `（コマンドはこれからもっと増える予定！お楽しみにっ！✨）`
  );
}

/**
 * 透明度コマンドを処理するよ！
 * @param commandParts コマンドの引数部分の配列
 * @param setMessage 画面にメッセージを表示するための関数
 * @param options コマンド実行に必要なオプション
 */
async function handleOpacityCommand(
  commandParts: string[],
  setMessage: (msg: string) => void,
  options?: {
    setOpacity?: (opacityValue: number) => Promise<void>;
    currentOpacity?: number;
    // 背景色変更用のオプションもここに追加するイメージだよ！
    // setBackgroundColor?: (color: string) => void;
  }
): Promise<void> {
  const { setOpacity, currentOpacity } = options || {};
  if (!setOpacity || currentOpacity === undefined) {
    setMessage('ごめんね、この環境では透明度を変更したり確認したりできないみたい… (´・ω・｀)');
    return;
  }

  const valueArg = commandParts[1];
  if (!valueArg) {
    setMessage(`現在のウィンドウの透明度は ${currentOpacity}% だよ！ (｀・ω・´)ゞ`);
  } else {
    const value = parseInt(valueArg, 10);
    if (isNaN(value) || value < 0 || value > 100) {
      setMessage(
        `透明度の指定がおかしいみたい… (ﾟｰﾟ;A\n` +
        `例: /opacity 80  (0から100の数字で指定してね！)`
      );
    } else {
      await setOpacity(value);
      setMessage(`ウィンドウの透明度を ${value}% にしたよ！ ✨`);
    }
  }
}

// 背景色コマンド用の処理関数！
/**
 * 背景色コマンドを処理するよ！
 * @param commandParts コマンドの引数部分の配列
 * @param setMessage 画面にメッセージを表示するための関数
 * @param options コマンド実行に必要なオプション
 */
function handleBackgroundColorCommand(
  commandParts: string[],
  setMessage: (msg: string) => void,
  options?: {
    setBackgroundColor?: (color: string) => void;
    currentBackgroundColor?: string;
  }
): void {
  const { setBackgroundColor, currentBackgroundColor } = options || {};
  if (!setBackgroundColor) {
    setMessage('ごめんね、この環境では背景色を変更できないみたい… (´・ω・｀)');
    return;
  }

  const colorArg = commandParts.slice(1).join(' '); // 色名にスペースが含まれる場合もOK！

  if (!colorArg) {
    if (currentBackgroundColor) {
      setMessage(`現在の背景色は「${currentBackgroundColor}」だよ！🎨`);
    } else {
      setMessage(`背景色を指定してね！ 例: /bgcolor lightblue または /bgcolor #RRGGBB`);
    }
  } else {
    setBackgroundColor(colorArg);
    setMessage(`背景色を「${colorArg}」にしたよ！🌈`);
  }
}

// ★★★ 検索履歴コマンド用の処理関数！ ★★★
/**
 * 検索履歴コマンドを処理するよ！
 * @param commandParts コマンドの引数部分の配列
 * @param setMessage 画面にメッセージを表示するための関数
 * @param options コマンド実行に必要なオプション
 */
async function handleHistoryCommand(
  commandParts: string[],
  setMessage: (msg: string) => void,
  options?: {
    searchHistory?: string[];
    setSearchHistory?: (newHistory: string[]) => void;
    saveSearchHistory?: () => Promise<void>;
    // maxHistoryCount はここでは直接使わないけど、将来的に設定コマンドを作るなら渡すかも！
  }
): Promise<void> {
  const { searchHistory, setSearchHistory, saveSearchHistory } = options || {};

  if (!searchHistory || !setSearchHistory || !saveSearchHistory) {
    setMessage('履歴機能がうまく動いてないみたい… (´・ω・｀)');
    return;
  }

  if (commandParts[1]?.toLowerCase() === 'clear') {
    setSearchHistory([]);
    await saveSearchHistory().catch(e => console.error('履歴のクリア保存に失敗…', e));
    setMessage('検索履歴をぜーんぶ消しちゃった！ (｀・ω・´)ゞ');
  } else if (searchHistory.length === 0) {
    setMessage('まだ検索履歴がないみたいだよ！これからたくさん検索してね！ ✨');
  } else {
    const historyText = "検索履歴だよ！ (Ctrl+↑/↓で入力欄にも出せるよ！)\n--------------------\n" + searchHistory.join('\n');
    setMessage(historyText);
  }
}

// コマンド名と処理関数をマッピングするオブジェクトだよ！
// これがディスパッチテーブルってやつだね！
const commandMap: {
  [key: string]: (
    commandParts: string[],
    setMessage: (msg: string) => void,
    options?: {
      setOpacity?: (opacityValue: number) => Promise<void>;
      currentOpacity?: number;
      setBackgroundColor?: (color: string) => void;
      currentBackgroundColor?: string;
      // ↓ 履歴関連のオプションも追加！
      searchHistory?: string[];
      setSearchHistory?: (newHistory: string[]) => void;
      saveSearchHistory?: () => Promise<void>;
    }
  ) => Promise<void> | void; // 非同期処理を含むコマンドがあるので Promise<void> | void
} = {
  help: (parts, setMessage) => handleHelpCommand(setMessage),
  opacity: handleOpacityCommand,
  bgcolor: handleBackgroundColorCommand,
  backgroundcolor: handleBackgroundColorCommand, // エイリアスも！
  history: handleHistoryCommand, // ★★★ 履歴コマンドを追加！ ★★★
  // 新しいコマンドはここにどんどん追加していけるよ！
  // 例: 'anotherCommand': handleAnotherCommand,
};

/**
 * スラッシュから始まるコマンドを処理するよ！
 * @param command コマンド文字列 (例: "/help")
 * @param setMessage 画面にメッセージを表示するための関数
 * @param options コマンド実行に必要な関数や現在の設定値とかをまとめたオブジェクトだよ！
 *   - `setOpacity?`: ウィンドウの透明度を設定する関数 (0-100)
 *   - `currentOpacity?`: 現在の透明度 (0-100)
 *   - `setBackgroundColor?`: 背景色を設定する関数 (CSSで有効な色文字列)
 *   - `currentBackgroundColor?`: 現在の背景色 (CSSで有効な色文字列)
 *   - `searchHistory?`: 現在の検索履歴の配列
 *   - `setSearchHistory?`: 検索履歴を更新する関数
 *   - `saveSearchHistory?`: 検索履歴を永続化する関数
 */
export async function handleCommand(
  command: string,
  setMessage: (msg: string) => void,
  // 引数をoptionsオブジェクトにまとめたよ！
  options?: {
    setOpacity?: (opacityValue: number) => Promise<void>;
    currentOpacity?: number;
    setBackgroundColor?: (color: string) => void;
    currentBackgroundColor?: string;
    // ↓ 履歴関連のオプションも追加！
    searchHistory?: string[];
    setSearchHistory?: (newHistory: string[]) => void;
    saveSearchHistory?: () => Promise<void>;
  }
): Promise<void> {
  const commandParts = command.substring(1).split(' ');
  const actualCommand = commandParts[0].toLowerCase(); // コマンド名を小文字に統一

  // commandMapから対応する処理関数を探すよ！
  const commandFunction = commandMap[actualCommand];

  if (commandFunction) {
    // 見つかったら、その関数を実行！
    // opacityコマンドが非同期処理なので、awaitで待つようにするよ
    await commandFunction(commandParts, setMessage, options);
  } else {
    // 見つからなかったら、知らないコマンドだって伝えるよ
    setMessage(`「/${actualCommand}」なんてコマンド、知らないなぁ… (´・ω・｀)\n/help で使えるコマンドを確認してみてね！`);
  }
}