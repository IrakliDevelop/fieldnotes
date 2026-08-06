import type { ElementStyle } from '@fieldnotes/core';

/**
 * The `ElementStyle` fields the selection-style hooks compare and cache.
 * Internal to `@fieldnotes/react` — not exported from the package index.
 * Shared between `useSelectionStyle` and `useSelectionStyleDetails` so the
 * two hooks cannot drift out of sync (a prior desync here dropped
 * `strokeStyle` from one hook's equality check and caused stale style data).
 */
export const STYLE_KEYS: readonly (keyof ElementStyle)[] = [
  'color',
  'fillColor',
  'strokeWidth',
  'opacity',
  'fontSize',
  'strokeStyle',
];
