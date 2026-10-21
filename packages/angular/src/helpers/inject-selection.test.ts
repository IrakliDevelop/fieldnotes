import { afterEach, describe, expect, it } from 'vitest';
import { SelectTool, createNote } from '@fieldnotes/core';
import type { Viewport } from '@fieldnotes/core';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { mountHelper } from '../test-utils/mount-helper';
import { injectSelection } from './inject-selection';

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

describe('injectSelection', () => {
  it('holds [] before a viewport exists', async () => {
    const { result } = await mountHelper(() => injectSelection(), null);
    expect(result()).toEqual([]);
  });

  it('returns an empty array initially', async () => {
    const { result } = await mountHelper(() => injectSelection());
    expect(result()).toEqual([]);
  });

  it('updates when the selection changes', async () => {
    const { viewport, select, noteId } = viewportWithNote();
    const { result } = await mountHelper(() => injectSelection(), viewport);
    select.setSelection([noteId]);
    expect(result()).toEqual([noteId]);
  });

  it('keeps the same array when an unrelated store change leaves the selection unchanged', async () => {
    const { viewport, select, noteId } = viewportWithNote();
    const { result } = await mountHelper(() => injectSelection(), viewport);
    select.setSelection([noteId]);
    const before = result();
    viewport.store.update(noteId, { position: { x: 99, y: 99 } });
    expect(result()).toBe(before);
  });
});
