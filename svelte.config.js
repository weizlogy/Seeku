import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.

    // adapter-auto から adapter-static に変更！
    adapter: adapter({
      // 静的ファイルを出力するフォルダを指定するよ
      // これでプロジェクトルートの 'build' フォルダに出力されるようになるはず！
      pages: 'build',
      assets: 'build',
      fallback: 'index.html', // SPAモードにするために、メインのHTMLファイルを指定するよ！
      precompress: false,
      strict: true
    })
	}
};

export default config;
