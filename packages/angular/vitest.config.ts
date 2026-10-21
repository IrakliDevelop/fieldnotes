import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';
import path from 'path';

const browserTests = {
  environment: 'jsdom',
  include: ['src/**/*.test.ts'],
  exclude: ['src/**/*.ssr.test.ts', 'src/ssr.test.ts'],
};

export default defineConfig({
  plugins: [angular({ tsconfig: path.resolve(import.meta.dirname, 'tsconfig.spec.json') })],
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
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test-utils/**', 'src/test-setup/**'],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
      },
    },
    projects: [
      {
        extends: true,
        test: { ...browserTests, name: 'zoneless', setupFiles: ['src/test-setup/zoneless.ts'] },
      },
      {
        extends: true,
        test: { ...browserTests, name: 'zone', setupFiles: ['src/test-setup/zone.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'ssr',
          environment: 'node',
          include: ['src/ssr.test.ts', 'src/**/*.ssr.test.ts'],
          setupFiles: ['src/test-setup/ssr.ts'],
        },
      },
    ],
  },
});
