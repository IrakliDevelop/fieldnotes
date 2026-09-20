import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve workspace deps to their TypeScript source so tests don't depend
      // on the packages being built first (mirrors packages/sync/vitest.config.ts).
      '@fieldnotes/vtt/server': path.resolve(__dirname, '../vtt/src/server.ts'),
      '@fieldnotes/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@fieldnotes/vtt': path.resolve(__dirname, '../vtt/src/index.ts'),
      '@fieldnotes/sync': path.resolve(__dirname, '../sync/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 89,
      },
    },
  },
});
