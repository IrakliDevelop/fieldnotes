import { describe, it, expect, afterEach } from 'vitest';
import { SelectTool, createNote } from '@fieldnotes/core';
import type { Viewport } from '@fieldnotes/core';
import { useSelection } from './use-selection.svelte.js';
import { mountHelper, record } from '../test-fixtures/mount-helper';
import { createTestViewport, destroyTestViewports } from '../test-fixtures/create-test-viewport';

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
    const { result } = mountHelper(() => useSelection());
    expect(record(result)).toEqual([[]]);
  });

  it('updates when the selection changes', () => {
    const { viewport, select, noteId } = viewportWithNote();
    const { result } = mountHelper(() => useSelection(), viewport);
    const values = record(result);
    select.setSelection([noteId]);
    expect(values.at(-1)).toEqual([noteId]);
  });

  it('does not notify when an unrelated store change leaves the selection unchanged', () => {
    const { viewport, select, noteId } = viewportWithNote();
    const { result } = mountHelper(() => useSelection(), viewport);
    const values = record(result);
    select.setSelection([noteId]);
    const count = values.length;
    viewport.store.update(noteId, { position: { x: 99, y: 99 } });
    expect(values).toHaveLength(count);
  });
});
