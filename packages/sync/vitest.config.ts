import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the core dependency to its TypeScript source so tests don't depend
      // on @fieldnotes/core being built first (mirrors packages/react/vitest.config.ts).
      '@fieldnotes/vtt/sync': path.resolve(__dirname, '../vtt/src/sync.ts'),
      '@fieldnotes/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@fieldnotes/vtt': path.resolve(__dirname, '../vtt/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 90,
        branches: 84,
        functions: 90,
      },
    },
  },
});
