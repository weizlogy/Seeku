/**
 * コマンド処理を担当するモジュールだよ！
 */
import { $_ } from '$lib/i18n'; // ← 翻訳関数をインポート！
import { get } from 'svelte/store'; // ← get関数をインポート！

// コマンドごとの処理を関数に切り出すよ！
// こうすることで、handleCommand関数がスッキリするし、
// 各コマンドの処理内容も分かりやすくなるんだ (o^-')b

/**
 * ヘルプコマンドを処理するよ！
 * @param setMessage 画面にメッセージを表示するための関数
 */
function handleHelpCommand(setMessage: (msg: string) => void): void {
  const t = get($_); // 翻訳関数を取得

  // ヘルプに表示するコマンドとその説明文のキーを定義するよ！
  // ここでフォーマットを管理するイメージ！
  const helpCommands: Array<{ name: string; descriptionKey: string; alias?: string }> = [
    { name: 'help', descriptionKey: 'commands.help.description.help' },
    { name: 'opacity', descriptionKey: 'commands.help.description.opacity' },
    { name: 'bgcolor', descriptionKey: 'commands.help.description.bgcolor', alias: 'backgroundcolor' }, // エイリアスも考慮
    { name: 'history', descriptionKey: 'commands.help.description.history' },
    { name: 'lang', descriptionKey: 'commands.help.description.lang' }, // ← 言語コマンドのヘルプ！
    // 新しいコマンドを追加したらここにも追加するよ！
  ];

  // ヘルプメッセージの共通部分（基本的な使い方とか）を取得
  let helpMessage = t('commands.help.intro') + '\n';
  helpMessage += t('commands.help.commandListHeader') + '\n';
  helpMessage += '--------------------------------------\n';

  // 各コマンドの説明をリストに追加
  helpCommands.forEach(cmd => {
    helpMessage += `・/${cmd.name}: ${t(cmd.descriptionKey)}\n`;
  });

  setMessage(helpMessage);
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
    setMessage(get($_)('commands.opacity.notSupported'));
    return;
  }

  const valueArg = commandParts[1];
  if (!valueArg) {
    setMessage(`現在のウィンドウの透明度は ${currentOpacity}% だよ！ (｀・ω・´)ゞ`);
  } else {
    const value = parseInt(valueArg, 10); // 数値に変換
    if (isNaN(value) || value < 0 || value > 100) {
      setMessage(get($_)('commands.opacity.invalidValueExample', { values: { example: '/opacity 80' } }));
    } else {
      // 透明度を設定
      await setOpacity(value);
      setMessage(get($_)('commands.opacity.set', { values: { opacity: value } }));
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
    setMessage(get($_)('commands.bgcolor.notSupported'));
    return;
  }

  const colorArg = commandParts.slice(1).join(' '); // 色名にスペースが含まれる場合もOK！

  if (!colorArg) {
    if (currentBackgroundColor) {
      setMessage(get($_)('commands.bgcolor.current', { values: { color: currentBackgroundColor } }));
    } else {
      setMessage(get($_)('commands.bgcolor.specifyColorExample', { values: { example1: '/bgcolor lightblue', example2: '/bgcolor #RRGGBB' } }));

    }
  } else {
    setBackgroundColor(colorArg);
    setMessage(get($_)('commands.bgcolor.set', { values: { color: colorArg } }));
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
    setMessage(get($_)('commands.history.error'));
    return;
  }

  if (commandParts[1]?.toLowerCase() === 'clear') {
    setSearchHistory([]);
    await saveSearchHistory().catch(e => console.error('履歴のクリア保存に失敗…', e));
    setMessage(get($_)('commands.history.cleared'));
  } else if (searchHistory.length === 0) {
    setMessage(get($_)('commands.history.empty'));
  } else {
    const historyText = "検索履歴だよ！ (Ctrl+↑/↓で入力欄にも出せるよ！)\n--------------------\n" + searchHistory.join('\n');
    setMessage(historyText);
  }
}

/**
 * 言語設定コマンドを処理するよ！
 * @param commandParts コマンドの引数部分の配列
 * @param setMessage 画面にメッセージを表示するための関数
 * @param options コマンド実行に必要なオプション
 */
function handleLangCommand(
  commandParts: string[],
  setMessage: (msg: string) => void,
  options?: {
    setLocale?: (newLocale: string) => void;
    currentLocale?: string | null | undefined; // i18nストアの型に合わせる
    availableLocales?: string[];
  }
): void {
  const t = get($_); // 翻訳関数を取得
  const { setLocale, currentLocale, availableLocales } = options || {};

  if (!setLocale || !availableLocales) {
    setMessage(t('commands.lang.notSupported'));
    return;
  }

  const langArg = commandParts[1]?.toLowerCase();

  if (!langArg) {
    const currentLangDisplay = currentLocale || t('commands.lang.currentUnknown'); // nullやundefinedの場合の表示
    const availableLangsText = availableLocales.join(', ');
    const msg1 = t('commands.lang.currentAndAvailable', { values: { current: currentLangDisplay, available: availableLangsText } } as any);
    const msg2 = t('commands.lang.usageExample', { values: { example: '/lang en' } } as any);
    setMessage(
      msg1 + `\n` + msg2
    );
  } else {
    if (availableLocales.includes(langArg)) {
      setLocale(langArg);
      setMessage(t('commands.lang.set', { values: { lang: langArg } } as any));
    } else {
      setMessage(
        t('commands.lang.invalidLang', { values: { lang: langArg } } as any) + `\n` + t('commands.lang.availableList', { values: { available: availableLocales.join(', ') } } as any)
      );
    }
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
      setLocale?: (newLocale: string) => void; // ← 言語設定用
      currentLocale?: string | null | undefined; // ← 現在の言語取得用
      availableLocales?: string[]; // ← 利用可能な言語リスト用
    }
  ) => Promise<void> | void; // 非同期処理を含むコマンドがあるので Promise<void> | void
} = {
  help: (parts, setMessage) => handleHelpCommand(setMessage),
  opacity: handleOpacityCommand,
  bgcolor: handleBackgroundColorCommand,
  backgroundcolor: handleBackgroundColorCommand, // エイリアスも！
  history: handleHistoryCommand, // ★★★ 履歴コマンドを追加！ ★★★
  lang: handleLangCommand, // ← 言語コマンドを追加！
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
 *   - `setLocale?`: 言語を設定する関数
 *   - `currentLocale?`: 現在の言語 (例: 'en', 'ja')
 *   - `availableLocales?`: 利用可能な言語の配列 (例: ['en', 'ja'])
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
    setLocale?: (newLocale: string) => void; // ← 追加！
    currentLocale?: string | null | undefined; // ← 追加！
    availableLocales?: string[]; // ← 追加！
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
    setMessage(get($_)('commands.unknown', { values: { command: actualCommand } }));
  }
}