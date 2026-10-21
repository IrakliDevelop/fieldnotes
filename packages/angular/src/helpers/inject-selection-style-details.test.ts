import { afterEach, describe, expect, it } from 'vitest';
import { SelectTool, createStroke } from '@fieldnotes/core';
import type { Viewport } from '@fieldnotes/core';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { mountHelper } from '../test-utils/mount-helper';
import { injectSelectionStyleDetails } from './inject-selection-style-details';

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

describe('injectSelectionStyleDetails', () => {
  it('holds null and throws from the setter before a viewport exists', async () => {
    const {
      result: [details, apply],
    } = await mountHelper(() => injectSelectionStyleDetails(), null);
    expect(details()).toBeNull();
    expect(() => apply({ color: '#ff0000' })).toThrow(
      '[fieldnotes] applySelectionStyle called before <fn-canvas> mounted',
    );
  });

  it('reports applicable and mixed fields, and null once the selection is empty', async () => {
    const viewport = createTestViewport();
    viewport.toolManager.register(new SelectTool());
    const ids = [addStroke(viewport, '#111111', 0), addStroke(viewport, '#222222', 20)];
    const {
      result: [details],
    } = await mountHelper(() => injectSelectionStyleDetails(), viewport);
    selectIds(viewport, ids);
    expect(details()?.applicable).toContain('color');
    expect(details()?.mixed).toContain('color');
    selectIds(viewport, []);
    expect(details()).toBeNull();
  });

  it('updates when a selected element is deleted', async () => {
    const viewport = createTestViewport();
    viewport.toolManager.register(new SelectTool());
    const ids = [addStroke(viewport, '#111111', 0), addStroke(viewport, '#222222', 20)];
    const {
      result: [details],
    } = await mountHelper(() => injectSelectionStyleDetails(), viewport);
    selectIds(viewport, ids);
    viewport.store.remove(ids[0] ?? '');
    expect(details()?.mixed).not.toContain('color');
    expect(details()?.common.color).toBe('#222222');
  });

  it('works when mounted before the select tool is registered', async () => {
    const viewport = createTestViewport();
    const {
      result: [details, apply],
    } = await mountHelper(() => injectSelectionStyleDetails(), viewport);
    expect(details()).toBeNull();
    viewport.toolManager.register(new SelectTool());
    const id = addStroke(viewport, '#333333', 0);
    selectIds(viewport, [id]);
    expect(details()?.common.color).toBe('#333333');
    apply({ color: '#444444' });
    expect(details()?.common.color).toBe('#444444');
  });
});
