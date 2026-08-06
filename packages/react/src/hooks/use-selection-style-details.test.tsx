// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { FieldNotesCanvas } from '../field-notes-canvas';
import { useSelectionStyleDetails } from './use-selection-style-details';
import { SelectTool, createStroke } from '@fieldnotes/core';
import type { SelectionStyleDetails, Viewport } from '@fieldnotes/core';

function setup(withSelectTool = true): {
  getDetails: () => SelectionStyleDetails | null;
  getVp: () => Viewport | null;
} {
  let details: SelectionStyleDetails | null = null;
  let vp: Viewport | null = null;

  function Consumer() {
    [details] = useSelectionStyleDetails();
    return null;
  }

  render(
    <FieldNotesCanvas
      tools={withSelectTool ? [new SelectTool()] : []}
      defaultTool={withSelectTool ? 'select' : undefined}
      onReady={(v) => {
        vp = v;
      }}
    >
      <Consumer />
    </FieldNotesCanvas>,
  );

  return {
    getDetails: () => details,
    getVp: () => vp,
  };
}

describe('useSelectionStyleDetails', () => {
  afterEach(cleanup);

  it('reports applicable + mixed for heterogeneous selections and null when empty', () => {
    const { getDetails, getVp } = setup();
    const vp = getVp();
    if (!vp) throw new Error('viewport not captured');

    const ids: string[] = [];
    act(() => {
      const a = createStroke({
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 10, y: 10, pressure: 0.5 },
        ],
        color: '#111111',
        width: 3,
        layerId: vp.layerManager.activeLayerId,
      });
      const b = createStroke({
        points: [
          { x: 20, y: 20, pressure: 0.5 },
          { x: 30, y: 30, pressure: 0.5 },
        ],
        color: '#222222',
        width: 3,
        layerId: vp.layerManager.activeLayerId,
      });
      vp.store.add(a);
      vp.store.add(b);
      ids.push(a.id, b.id);
    });

    act(() => {
      const sel = vp.toolManager.getTool<SelectTool>('select');
      sel?.setSelection(ids);
    });

    const details = getDetails();
    expect(details?.applicable).toContain('color');
    expect(details?.mixed).toContain('color');

    act(() => {
      const sel = vp.toolManager.getTool<SelectTool>('select');
      sel?.setSelection([]);
    });

    expect(getDetails()).toBeNull();
  });

  it('updates when a selected element is deleted (no pointer events)', () => {
    const { getDetails, getVp } = setup();
    const vp = getVp();
    if (!vp) throw new Error('viewport not captured');

    const ids: string[] = [];
    act(() => {
      const a = createStroke({
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 10, y: 10, pressure: 0.5 },
        ],
        color: '#111111',
        width: 3,
        layerId: vp.layerManager.activeLayerId,
      });
      const b = createStroke({
        points: [
          { x: 20, y: 20, pressure: 0.5 },
          { x: 30, y: 30, pressure: 0.5 },
        ],
        color: '#222222',
        width: 3,
        layerId: vp.layerManager.activeLayerId,
      });
      vp.store.add(a);
      vp.store.add(b);
      ids.push(a.id, b.id);
    });

    act(() => {
      const sel = vp.toolManager.getTool<SelectTool>('select');
      sel?.setSelection(ids);
    });

    expect(getDetails()?.mixed).toContain('color');

    act(() => {
      const [firstId] = ids;
      if (firstId !== undefined) vp.store.remove(firstId);
    });

    const details = getDetails();
    expect(details?.mixed).not.toContain('color');
    expect(details?.common.color).toBe('#222222');
  });

  it('subscription works when the hook mounts BEFORE the select tool is registered', () => {
    const { getDetails, getVp } = setup(false);
    const vp = getVp();
    if (!vp) throw new Error('viewport not captured');

    expect(getDetails()).toBeNull();

    let strokeId = '';
    act(() => {
      vp.toolManager.register(new SelectTool());
      const stroke = createStroke({
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 10, y: 10, pressure: 0.5 },
        ],
        color: '#333333',
        width: 2,
        layerId: vp.layerManager.activeLayerId,
      });
      vp.store.add(stroke);
      strokeId = stroke.id;
    });

    act(() => {
      const sel = vp.toolManager.getTool<SelectTool>('select');
      sel?.setSelection([strokeId]);
    });

    expect(getDetails()).not.toBeNull();
    expect(getDetails()?.common.color).toBe('#333333');
  });
});
