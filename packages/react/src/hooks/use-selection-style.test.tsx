// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { FieldNotesCanvas } from '../field-notes-canvas';
import { useSelectionStyle } from './use-selection-style';
import { SelectTool, createStroke, createArrow } from '@fieldnotes/core';
import type { ElementStyle, Viewport } from '@fieldnotes/core';

describe('useSelectionStyle', () => {
  afterEach(cleanup);

  it('returns null when nothing is selected', () => {
    const seen: { style: ElementStyle | null | undefined } = { style: undefined };
    function Consumer() {
      [seen.style] = useSelectionStyle();
      return null;
    }

    render(
      <FieldNotesCanvas tools={[new SelectTool()]} defaultTool="select">
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(seen.style).toBeNull();
  });

  it('reflects normalized style of the selected element', () => {
    const seen: { style: ElementStyle | null } = { style: null };
    let vp: Viewport | null = null;
    function Consumer() {
      [seen.style] = useSelectionStyle();
      return null;
    }

    render(
      <FieldNotesCanvas
        tools={[new SelectTool()]}
        defaultTool="select"
        onReady={(v) => {
          vp = v;
        }}
      >
        <Consumer />
      </FieldNotesCanvas>,
    );

    let strokeId = '';
    act(() => {
      const stroke = createStroke({
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 10, y: 10, pressure: 0.5 },
        ],
        color: '#123456',
        width: 3,
        layerId: vp?.layerManager.activeLayerId ?? '',
      });
      vp?.store.add(stroke);
      strokeId = stroke.id;
    });

    act(() => {
      const sel = vp?.toolManager.getTool<SelectTool>('select');
      sel?.setSelection([strokeId]);
    });

    expect(seen.style?.color).toBe('#123456');
    expect(seen.style?.strokeWidth).toBe(3);
  });

  it('applies style patch to the selected element when setter is called', () => {
    let applyStyle: ((s: ElementStyle) => void) | null = null;
    const captured: { vp: Viewport | null } = { vp: null };
    function Consumer() {
      const [, set] = useSelectionStyle();
      applyStyle = set;
      return null;
    }

    render(
      <FieldNotesCanvas
        tools={[new SelectTool()]}
        defaultTool="select"
        onReady={(v) => {
          captured.vp = v;
        }}
      >
        <Consumer />
      </FieldNotesCanvas>,
    );

    let strokeId = '';
    act(() => {
      const stroke = createStroke({
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 10, y: 10, pressure: 0.5 },
        ],
        color: '#000000',
        width: 1,
        layerId: captured.vp?.layerManager.activeLayerId ?? '',
      });
      captured.vp?.store.add(stroke);
      strokeId = stroke.id;
    });

    act(() => {
      const sel = captured.vp?.toolManager.getTool<SelectTool>('select');
      sel?.setSelection([strokeId]);
    });

    act(() => {
      applyStyle?.({ color: '#ff0000' });
    });

    const updated = captured.vp?.store.getById(strokeId);
    // stroke.color maps to ElementStyle.color
    expect((updated as { color?: string } | undefined)?.color).toBe('#ff0000');
  });

  it('updates reactively when the store changes under a stable selection', () => {
    const seen: { style: ElementStyle | null } = { style: null };
    let vp: Viewport | null = null;
    function Consumer() {
      [seen.style] = useSelectionStyle();
      return null;
    }

    render(
      <FieldNotesCanvas
        tools={[new SelectTool()]}
        defaultTool="select"
        onReady={(v) => {
          vp = v;
        }}
      >
        <Consumer />
      </FieldNotesCanvas>,
    );

    let strokeId = '';
    act(() => {
      const stroke = createStroke({
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 10, y: 10, pressure: 0.5 },
        ],
        color: '#aabbcc',
        width: 2,
        layerId: vp?.layerManager.activeLayerId ?? '',
      });
      vp?.store.add(stroke);
      strokeId = stroke.id;
    });

    act(() => {
      const sel = vp?.toolManager.getTool<SelectTool>('select');
      sel?.setSelection([strokeId]);
    });

    expect(seen.style?.color).toBe('#aabbcc');

    act(() => {
      vp?.store.update(strokeId, { color: '#ddeeff' });
    });

    expect(seen.style?.color).toBe('#ddeeff');
  });

  it('re-renders when only strokeStyle changes', () => {
    const seen: { style: ElementStyle | null } = { style: null };
    let vp: Viewport | null = null;
    function Consumer() {
      [seen.style] = useSelectionStyle();
      return null;
    }

    render(
      <FieldNotesCanvas
        tools={[new SelectTool()]}
        defaultTool="select"
        onReady={(v) => {
          vp = v;
        }}
      >
        <Consumer />
      </FieldNotesCanvas>,
    );

    let arrowId = '';
    act(() => {
      const arrow = createArrow({
        from: { x: 0, y: 0 },
        to: { x: 10, y: 10 },
        color: '#000000',
        width: 2,
        layerId: vp?.layerManager.activeLayerId ?? '',
      });
      vp?.store.add(arrow);
      arrowId = arrow.id;
    });

    act(() => {
      const sel = vp?.toolManager.getTool<SelectTool>('select');
      sel?.setSelection([arrowId]);
    });

    expect(seen.style?.strokeStyle).toBeUndefined();

    act(() => {
      vp?.applyStyleToSelection({ strokeStyle: 'dashed' });
    });

    expect(seen.style?.strokeStyle).toBe('dashed');
  });
});
