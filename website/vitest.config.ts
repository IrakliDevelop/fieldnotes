import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/lib/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**/*.ts'],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
      },
    },
  },
});
