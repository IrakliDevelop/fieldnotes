import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@fieldnotes/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@fieldnotes/sync': path.resolve(__dirname, '../sync/src/index.ts'),
      '@fieldnotes/sync-server': path.resolve(__dirname, '../sync-server/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
