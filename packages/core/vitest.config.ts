import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
      },
      exclude: [
        '**/types.ts',
        'src/perf.bench.ts',
        'src/test-helpers/**',
        'src/index.ts',
        'src/index.test.ts',
        'src/test-setup.ts',
      ],
    },
  },
});
