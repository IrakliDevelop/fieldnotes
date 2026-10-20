import { describe, it, expect, afterEach } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';
import { SelectTool, createStroke } from '@fieldnotes/core';
import type { Viewport } from '@fieldnotes/core';
import { useSelectionStyleDetails } from './use-selection-style-details';
import { mountComposable } from '../test-utils/mount-composable';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';

enableAutoUnmount(afterEach);
afterEach(destroyTestViewports);

function addStroke(viewport: Viewport, color: string, at: number): string {
  const stroke = createStroke({
    points: [
      { x: at, y: at, pressure: 0.5 },
      { x: at + 10, y: at + 10, pressure: 0.5 },
    ],
    color,
    width: 3,
    layerId: viewport.layerManager.activeLayerId,
  });
  viewport.store.add(stroke);
  return stroke.id;
}

function selectIds(viewport: Viewport, ids: string[]): void {
  viewport.toolManager.getTool<SelectTool>('select')?.setSelection(ids);
}

describe('useSelectionStyleDetails', () => {
  it('reports applicable and mixed fields, and null once the selection is empty', () => {
    const viewport = createTestViewport();
    viewport.toolManager.register(new SelectTool());
    const ids = [addStroke(viewport, '#111111', 0), addStroke(viewport, '#222222', 20)];
    const {
      result: [details],
    } = mountComposable(() => useSelectionStyleDetails(), viewport);
    selectIds(viewport, ids);
    expect(details.value?.applicable).toContain('color');
    expect(details.value?.mixed).toContain('color');
    selectIds(viewport, []);
    expect(details.value).toBeNull();
  });

  it('updates when a selected element is deleted', () => {
    const viewport = createTestViewport();
    viewport.toolManager.register(new SelectTool());
    const ids = [addStroke(viewport, '#111111', 0), addStroke(viewport, '#222222', 20)];
    const {
      result: [details],
    } = mountComposable(() => useSelectionStyleDetails(), viewport);
    selectIds(viewport, ids);
    viewport.store.remove(ids[0] ?? '');
    expect(details.value?.mixed).not.toContain('color');
    expect(details.value?.common.color).toBe('#222222');
  });

  it('works when mounted before the select tool is registered', () => {
    const {
      result: [details, apply],
      viewport,
    } = mountComposable(() => useSelectionStyleDetails());
    expect(details.value).toBeNull();
    viewport.toolManager.register(new SelectTool());
    const id = addStroke(viewport, '#333333', 0);
    selectIds(viewport, [id]);
    expect(details.value?.common.color).toBe('#333333');
    apply({ color: '#444444' });
    expect(details.value?.common.color).toBe('#444444');
  });
});
