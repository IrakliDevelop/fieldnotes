// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ViewportHarness } from '../test-helpers/viewport-harness';
import { createViewportHarness } from '../test-helpers/viewport-harness';
import { tap } from '../test-helpers/pointer-helpers';

const ALL_TOOLS = [
  'select',
  'hand',
  'pencil',
  'eraser',
  'shape',
  'arrow',
  'note',
  'text',
  'image',
  'template',
  'measure',
] as const;

describe('Integration: edge cases', () => {
  let h: ViewportHarness;

  beforeEach(() => {
    h = createViewportHarness();
  });

  afterEach(() => {
    h.cleanup();
  });

  it('rapid tool switching does not crash', () => {
    for (let i = 0; i < 3; i++) {
      for (const tool of ALL_TOOLS) {
        h.viewport.toolManager.setTool(tool, h.viewport.toolContext);
      }
    }

    expect(h.viewport.toolManager.activeTool?.name).toBe('measure');
  });

  it('tap on empty canvas with each tool does not crash', () => {
    for (const tool of ALL_TOOLS) {
      h.viewport.toolManager.setTool(tool, h.viewport.toolContext);
      tap(h.wrapper, 400, 300);
    }

    expect(true).toBe(true);
  });

  it('zero-size drag with shape creates nothing', () => {
    h.viewport.toolManager.setTool('shape', h.viewport.toolContext);
    tap(h.wrapper, 200, 200);
    expect(h.viewport.store.getElementsByType('shape')).toHaveLength(0);
  });

  it('zero-size drag with arrow creates nothing', () => {
    h.viewport.toolManager.setTool('arrow', h.viewport.toolContext);
    tap(h.wrapper, 200, 200);
    expect(h.viewport.store.getElementsByType('arrow')).toHaveLength(0);
  });

  it('zero-size drag with pencil creates nothing', () => {
    h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);
    tap(h.wrapper, 200, 200);
    expect(h.viewport.store.getElementsByType('stroke')).toHaveLength(0);
  });

  it('undo on empty history is no-op', () => {
    const result = h.viewport.undo();
    expect(result).toBe(false);
    expect(h.viewport.store.count).toBe(0);
  });

  it('redo on empty history is no-op', () => {
    const result = h.viewport.redo();
    expect(result).toBe(false);
    expect(h.viewport.store.count).toBe(0);
  });

  it('export empty canvas produces valid state', () => {
    const json = h.viewport.exportJSON();
    const parsed: unknown = JSON.parse(json);

    const state = parsed as Record<string, unknown>;
    expect(typeof state['version']).toBe('number');
    expect(state['camera']).toBeDefined();
    expect(Array.isArray(state['elements'])).toBe(true);
    expect((state['elements'] as unknown[]).length).toBe(0);
  });
});
