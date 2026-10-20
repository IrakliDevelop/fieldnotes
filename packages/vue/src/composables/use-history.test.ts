import { describe, it, expect, afterEach } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';
import { useHistory } from './use-history';
import { mountComposable } from '../test-utils/mount-composable';
import { destroyTestViewports } from '../test-utils/create-test-viewport';

enableAutoUnmount(afterEach);
afterEach(destroyTestViewports);

const noopCommand = { execute: () => undefined, undo: () => undefined };

describe('useHistory', () => {
  it('starts with nothing to undo or redo', () => {
    const { result } = mountComposable(() => useHistory());
    expect(result.canUndo.value).toBe(false);
    expect(result.canRedo.value).toBe(false);
  });

  it('canUndo becomes true after a command is pushed', () => {
    const { result, viewport } = mountComposable(() => useHistory());
    viewport.history.push(noopCommand);
    expect(result.canUndo.value).toBe(true);
  });

  it('undo and redo update the flags', () => {
    const { result, viewport } = mountComposable(() => useHistory());
    const { canUndo, canRedo, undo, redo } = result;
    viewport.history.push(noopCommand);
    undo();
    expect([canUndo.value, canRedo.value]).toEqual([false, true]);
    redo();
    expect([canUndo.value, canRedo.value]).toEqual([true, false]);
  });
});
