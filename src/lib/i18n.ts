import { register, init, getLocaleFromNavigator, locale as currentLocaleStore, t } from 'svelte-i18n';
import type { Writable } from 'svelte/store';

// 利用可能なロケールのリストを保持するよ！
export const availableLocales: string[] = [];

// 型定義をしっかり書くよ！(๑˃̵ᴗ˂̵)و
// register関数の第二引数の型は、動的インポートされたJSONモジュールを返す関数になるよ
// JSONモジュールの中身の型を厳密に定義することもできるけど、
// ここでは Record<string, any> (キーが文字列で値が任意、みたいな意味) を使うね！
function registerLocale(locale: string, loader: () => Promise<Record<string, any>>): void {
  register(locale, loader);
  if (!availableLocales.includes(locale)) {
    availableLocales.push(locale);
  }
}
registerLocale('en', (): Promise<Record<string, any>> => import('./locales/en.json'));
registerLocale('ja', (): Promise<Record<string, any>> => import('./locales/ja.json'));
// 他の言語もここに追加していくよ！ 例: register('es', (): Promise<Record<string, any>> => import('./locales/es.json'));

// ブラウザの言語設定、localStorage、フォールバックの順で初期ロケールを決めるよ
const initialLocale: string | null = (() => {
  if (typeof window !== 'undefined') { // ブラウザ環境でのみ実行
    return localStorage.getItem('lang') || getLocaleFromNavigator();
  }
  return null; // SSR時などはnull
})();

init({
  fallbackLocale: 'en', // もし翻訳が見つからなかった時のデフォルト言語
  initialLocale: initialLocale || 'en', // 初期表示する言語 (nullならフォールバック)
});

// currentLocaleStore の型を明示的に Writable<string | null> にするよ
// svelte-i18n の locale は string | null | undefined を許容する Writable ストアだからね！
export const currentLocale: Writable<string | null | undefined> = currentLocaleStore;

// 翻訳関数をエクスポートするよ！これでSvelteファイルから簡単に使えるね！
export const $_ = t;

// 言語設定を保存・更新する関数
export function setLocale(newLocale: string): void {
  currentLocale.set(newLocale);
  if (typeof window !== 'undefined') { // ブラウザ環境でのみ実行
    localStorage.setItem('lang', newLocale); // localStorage に保存する例
  }
}
