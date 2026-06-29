import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the core dependency to its TypeScript source so tests don't depend
      // on @fieldnotes/core being built first (mirrors packages/react/vitest.config.ts).
      '@fieldnotes/core': path.resolve(__dirname, '../core/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
  },
});
