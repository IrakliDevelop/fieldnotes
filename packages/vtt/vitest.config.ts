import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the core dependency to its TypeScript source so tests don't depend
      // on @fieldnotes/core being built first (mirrors packages/sync/vitest.config.ts).
      '@fieldnotes/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@fieldnotes/sync': path.resolve(__dirname, '../sync/src/index.ts'),
      '@fieldnotes/sync-server': path.resolve(__dirname, '../sync-server/src/index.ts'),
      '@fieldnotes/sync-redis': path.resolve(__dirname, '../sync-redis/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
  },
});
