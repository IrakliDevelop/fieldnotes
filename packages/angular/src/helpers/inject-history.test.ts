import { afterEach, describe, expect, it } from 'vitest';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { mountHelper } from '../test-utils/mount-helper';
import { injectHistory } from './inject-history';

afterEach(destroyTestViewports);

const noopCommand = { execute: () => undefined, undo: () => undefined };

describe('injectHistory', () => {
  it('holds false flags and throws from actions before a viewport exists', async () => {
    const { result } = await mountHelper(() => injectHistory(), null);
    expect([result.canUndo(), result.canRedo()]).toEqual([false, false]);
    expect(() => result.undo()).toThrow('[fieldnotes] undo called before <fn-canvas> mounted');
    expect(() => result.redo()).toThrow('[fieldnotes] redo called before <fn-canvas> mounted');
  });

  it('starts with nothing to undo or redo', async () => {
    const { result } = await mountHelper(() => injectHistory());
    expect(result.canUndo()).toBe(false);
    expect(result.canRedo()).toBe(false);
  });

  it('canUndo becomes true after a command is pushed', async () => {
    const viewport = createTestViewport();
    const { result } = await mountHelper(() => injectHistory(), viewport);
    viewport.history.push(noopCommand);
    expect(result.canUndo()).toBe(true);
  });

  it('undo and redo update the flags', async () => {
    const viewport = createTestViewport();
    const { result } = await mountHelper(() => injectHistory(), viewport);
    const { canUndo, canRedo, undo, redo } = result;
    viewport.history.push(noopCommand);
    undo();
    expect([canUndo(), canRedo()]).toEqual([false, true]);
    redo();
    expect([canUndo(), canRedo()]).toEqual([true, false]);
  });
});
