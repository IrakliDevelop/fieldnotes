import type { Viewport, ViewportOptions } from '@fieldnotes/core';

/** What a module under `src/examples/` exports when a `::board` names it. */
export interface BoardExample {
  /** Mounts the board with `tools: 'default'` merged with `extra`. */
  createBoard(container: HTMLElement, extra?: ViewportOptions): Viewport;
  /** Seeds the mounted board. */
  setup?(viewport: Viewport): void;
}
