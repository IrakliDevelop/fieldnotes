import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@fieldnotes/core': path.resolve(import.meta.dirname, '../core/src/index.ts'),
    },
  },
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['src/test-fixtures/**', 'src/**/*.test.ts'],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
      },
    },
    projects: [
      {
        extends: true,
        plugins: [svelte(), svelteTesting()],
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/**/*.test.ts'],
          exclude: ['src/ssr.test.ts', 'src/**/*.ssr.test.ts'],
        },
      },
      {
        extends: true,
        // The node environment transforms in SSR mode, so components compile with generate: 'server'.
        plugins: [svelte()],
        test: {
          name: 'ssr',
          environment: 'node',
          include: ['src/ssr.test.ts', 'src/**/*.ssr.test.ts'],
        },
      },
    ],
  },
});
