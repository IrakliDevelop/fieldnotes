import type { BoardExample } from './types';

/** The example modules a `::board` can name, each loaded on its board's first mount. */
export const boardExamples: Record<string, () => Promise<BoardExample>> = {
  'getting-started': () => import('../examples/getting-started'),
  'html-elements': () => import('../examples/html-elements'),
};
