import { describe, it, expect, afterEach } from 'vitest';
import { useHistory } from './use-history.svelte.js';
import { mountHelper, record } from '../test-fixtures/mount-helper';
import { destroyTestViewports } from '../test-fixtures/create-test-viewport';

afterEach(destroyTestViewports);

const noopCommand = { execute: () => undefined, undo: () => undefined };

describe('useHistory', () => {
  it('starts with nothing to undo or redo', () => {
    const { result } = mountHelper(() => useHistory());
    expect(record(result)).toEqual([{ canUndo: false, canRedo: false }]);
  });

  it('canUndo becomes true after a command is pushed', () => {
    const { result, viewport } = mountHelper(() => useHistory());
    const values = record(result);
    viewport.history.push(noopCommand);
    expect(values.at(-1)?.canUndo).toBe(true);
  });

  it('undo and redo update the flags', () => {
    const { result, viewport } = mountHelper(() => useHistory());
    const values = record(result);
    const { undo, redo } = result;
    viewport.history.push(noopCommand);
    undo();
    expect(values.at(-1)).toEqual({ canUndo: false, canRedo: true });
    redo();
    expect(values.at(-1)).toEqual({ canUndo: true, canRedo: false });
  });
});
