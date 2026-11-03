import { defineConfig } from 'vitest/config';
import path from 'node:path';

const own = (name: string) => path.resolve(__dirname, 'node_modules', name);

// The React package's own tests, with react, react-dom and Testing Library taken from this
// package's React 18 install instead of the React 19 the package develops against.
export default defineConfig({
  root: path.resolve(__dirname, '..'),
  resolve: {
    alias: [
      { find: /^react-dom(\/.*)?$/, replacement: `${own('react-dom')}$1` },
      { find: /^react(\/.*)?$/, replacement: `${own('react')}$1` },
      { find: '@testing-library/react', replacement: own('@testing-library/react') },
      { find: '@fieldnotes/core', replacement: path.resolve(__dirname, '../../core/src/index.ts') },
    ],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'react18/*.test.ts'],
  },
});
