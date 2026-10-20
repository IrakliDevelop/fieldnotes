import { describe, it, expect, afterEach } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';
import { SelectTool, createNote } from '@fieldnotes/core';
import type { Viewport } from '@fieldnotes/core';
import { useSelection } from './use-selection';
import { mountComposable } from '../test-utils/mount-composable';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';

enableAutoUnmount(afterEach);
afterEach(destroyTestViewports);

function viewportWithNote(): { viewport: Viewport; select: SelectTool; noteId: string } {
  const viewport = createTestViewport();
  const select = new SelectTool();
  viewport.toolManager.register(select);
  viewport.setTool('select');
  const note = createNote({ position: { x: 0, y: 0 } });
  viewport.store.add(note);
  return { viewport, select, noteId: note.id };
}

describe('useSelection', () => {
  it('returns an empty array initially', () => {
    const { result } = mountComposable(() => useSelection());
    expect(result.value).toEqual([]);
  });

  it('updates when the selection changes', () => {
    const { viewport, select, noteId } = viewportWithNote();
    const { result } = mountComposable(() => useSelection(), viewport);
    select.setSelection([noteId]);
    expect(result.value).toEqual([noteId]);
  });

  it('keeps the same array when an unrelated store change leaves the selection unchanged', () => {
    const { viewport, select, noteId } = viewportWithNote();
    const { result } = mountComposable(() => useSelection(), viewport);
    select.setSelection([noteId]);
    const before = result.value;
    viewport.store.update(noteId, { position: { x: 99, y: 99 } });
    expect(result.value).toBe(before);
  });
});
