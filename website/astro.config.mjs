import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://iraklidevelop.github.io',
  base: process.env.FIELDNOTES_BASE ?? '/',
  trailingSlash: 'always',
});
