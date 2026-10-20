import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  // svelte-package leaves its staging copy here; node_modules keeps it out of git and Vitest.
  outDir: 'node_modules/.svelte-package',
};
