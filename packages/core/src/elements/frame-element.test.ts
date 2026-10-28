import { describe, expect, it } from 'vitest';
import {
  FRAME_ELEMENT_TYPE,
  createFrame,
  frameElementDefinition,
  isFrameElement,
} from './frame-element';
import { ElementRegistry } from './element-registry';
import type { FrameElement } from './frame-element';

function frame(): FrameElement {
  return createFrame({ position: { x: 10, y: 20 }, size: { w: 120, h: 90 } });
}

function interaction() {
  const value = frameElementDefinition.interaction;
  if (!value?.hitTestHandle || !value.updateHandle) throw new Error('Missing frame interaction');
  return value;
}

describe('frame element', () => {
  it('creates a complete frame with defaults and outer bounds', () => {
    const frame = createFrame({ position: { x: 10, y: 20 }, size: { w: 120, h: 90 } });

    expect(FRAME_ELEMENT_TYPE).toBe('core:frame');
    expect(frame).toMatchObject({
      type: 'extension',
      extensionType: 'core:frame',
      position: { x: 10, y: 20 },
      size: { w: 120, h: 90 },
      data: { title: 'Frame', color: '#64748b' },
      dataVersion: 1,
      layerId: '',
      index: '',
      version: 1,
      locked: false,
    });
    expect(frameElementDefinition.bounds(frame)).toEqual({ x: 10, y: 20, w: 120, h: 90 });
    expect(isFrameElement(frame)).toBe(true);
  });

  it('uses the header as its clip bounds and rejects invalid creation geometry', () => {
    expect(frameElementDefinition.clipBounds?.(frame())).toEqual({ x: 10, y: 44, w: 120, h: 66 });
    expect(() => createFrame({ position: { x: Infinity, y: 0 }, size: { w: 120, h: 90 } })).toThrow(
      /finite/,
    );
    expect(() => createFrame({ position: { x: 0, y: 0 }, size: { w: 79, h: 48 } })).toThrow(
      /80 x 48/,
    );
  });

  it('requires a complete valid frame envelope', () => {
    const registry = new ElementRegistry();
    const adapter = registry.getAdapter(FRAME_ELEMENT_TYPE);
    if (!adapter) throw new Error('Missing frame adapter');
    const valid = frame();
    expect(adapter.validateEnvelope(valid)).toBe(true);
    for (const invalid of [
      { ...valid, size: { w: 79, h: 90 } },
      { ...valid, position: { x: Number.NaN, y: 20 } },
      { ...valid, rotation: 0 },
      { ...valid, parentId: 'parent' },
      { ...valid, size: undefined },
      { ...valid, data: { title: 1, color: '#64748b' } },
      { ...valid, data: { title: 'Frame', color: 1 } },
    ]) {
      expect(adapter.validateEnvelope(invalid as FrameElement)).toBe(false);
    }
  });

  it('hits header and border but leaves transparent content alone', () => {
    const value = frame();
    expect(frameElementDefinition.hitTest?.(value, { x: 70, y: 30 })).toBe(true);
    expect(frameElementDefinition.hitTest?.(value, { x: 12, y: 75 })).toBe(true);
    expect(frameElementDefinition.hitTest?.(value, { x: 70, y: 75 })).toBe(false);
  });

  it('renders transparent canvas and escaped SVG chrome', () => {
    const calls: string[] = [];
    const ctx = {
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      strokeRect: () => calls.push('strokeRect'),
      beginPath: () => calls.push('beginPath'),
      moveTo: () => calls.push('moveTo'),
      lineTo: () => calls.push('lineTo'),
      stroke: () => calls.push('stroke'),
      fillText: () => calls.push('fillText'),
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
      font: '',
      textBaseline: 'alphabetic',
    } as unknown as CanvasRenderingContext2D;
    const value = { ...frame(), data: { title: '<Frame &>', color: '"<&' } };
    frameElementDefinition.render?.(ctx, value, []);
    expect(calls).toEqual([
      'save',
      'strokeRect',
      'beginPath',
      'moveTo',
      'lineTo',
      'stroke',
      'fillText',
      'restore',
    ]);
    expect(calls).not.toContain('fillRect');
    expect(frameElementDefinition.emitSvg?.(value, [], { x: 0, y: 0, w: 1, h: 1 })).toContain(
      '&lt;Frame &amp;&gt;',
    );
    expect(frameElementDefinition.emitSvg?.(value, [], { x: 0, y: 0, w: 1, h: 1 })).toContain(
      '&quot;&lt;&amp;',
    );
  });

  it.each([
    ['nw', { x: 200, y: 300 }, { x: 50, y: 62, w: 80, h: 48 }],
    ['ne', { x: 90, y: 300 }, { x: 10, y: 62, w: 80, h: 48 }],
    ['sw', { x: 200, y: 40 }, { x: 50, y: 20, w: 80, h: 48 }],
    ['se', { x: 20, y: 30 }, { x: 10, y: 20, w: 80, h: 48 }],
  ])(
    'resizes %s from the fixed opposite corner and clamps minimum size',
    (handle, point, expected) => {
      const updated = interaction().updateHandle(frame(), handle, point, {
        zoom: 1,
        shiftKey: false,
        selectedCount: 1,
        snap: { enabled: false },
      });
      expect({ ...updated.position, ...updated.size }).toEqual(expected);
    },
  );

  it('aligns custom corner hit zones with the selection overlay', () => {
    const hit = interaction().hitTestHandle(
      frame(),
      { x: 6, y: 16 },
      {
        zoom: 1,
        shiftKey: false,
        selectedCount: 1,
        snap: { enabled: false },
      },
    );
    expect(hit).toEqual({ id: 'nw', cursor: 'nwse-resize' });
  });
});
