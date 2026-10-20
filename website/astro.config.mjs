import { fileURLToPath } from 'node:url';
import { unified } from '@astrojs/markdown-remark';
import { defineConfig } from 'astro/config';
import remarkDirective from 'remark-directive';
import { readExamples } from './src/lib/directives.ts';
import { remarkFieldnotes } from './src/lib/remark-fieldnotes.ts';
import { codeTheme } from './src/styles/code-theme.ts';

const base = process.env.FIELDNOTES_BASE ?? '/';
const examples = readExamples(fileURLToPath(new URL('./src/examples/', import.meta.url)));

export default defineConfig({
  site: 'https://iraklidevelop.github.io',
  base,
  trailingSlash: 'always',
  markdown: {
    shikiConfig: { theme: codeTheme },
    processor: unified({ remarkPlugins: [remarkDirective, [remarkFieldnotes, { base, examples }]] }),
  },
});
