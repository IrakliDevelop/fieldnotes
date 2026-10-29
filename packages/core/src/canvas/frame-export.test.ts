import { describe, expect, it, vi } from 'vitest';
import { createShape } from '../elements/element-factory';
import { createFrame } from '../elements/frame-element';
import { ElementStore } from '../elements/element-store';
import { resolveFrameExport } from './frame-export';

describe('resolveFrameExport', () => {
  it('uses the frame content rectangle and captures only descendants in document order', () => {
    const store = new ElementStore();
    const frame = createFrame({
      position: { x: 10.0625, y: 20.0625 },
      size: { w: 80.0625, h: 48.0625 },
      index: 'a0',
    });
    frame.id = 'frame';
    const first = createShape({
      parentId: frame.id,
      index: 'a0',
      position: { x: 20, y: 50 },
      size: { w: 5, h: 5 },
    });
    first.id = 'first';
    const nested = createShape({
      parentId: first.id,
      index: 'a0',
      position: { x: 21, y: 51 },
      size: { w: 5, h: 5 },
    });
    nested.id = 'nested';
    const second = createShape({
      parentId: frame.id,
      index: 'a1',
      position: { x: 30, y: 50 },
      size: { w: 5, h: 5 },
    });
    second.id = 'second';
    const overlap = createShape({
      index: 'a1',
      position: { x: 10, y: 44 },
      size: { w: 80, h: 24 },
    });
    overlap.id = 'overlap';
    store.add(frame);
    store.add(first);
    store.add(nested);
    store.add(second);
    store.add(overlap);

    expect(resolveFrameExport(store, frame.id)).toEqual({
      region: { x: 10.0625, y: 44.0625, w: 80.0625, h: 24.0625 },
      descendantIds: new Set(['first', 'nested', 'second']),
    });
  });

  it('returns no descendants for an empty frame and rejects invalid targets', () => {
    const store = new ElementStore();
    const frame = createFrame({ position: { x: 0, y: 0 }, size: { w: 80, h: 48 } });
    frame.id = 'frame';
    const shape = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    shape.id = 'shape';
    store.add(frame);
    store.add(shape);

    expect(resolveFrameExport(store, frame.id)?.descendantIds).toEqual(new Set());
    expect(() => resolveFrameExport(store, 'missing')).toThrow(/frameId/);
    expect(() => resolveFrameExport(store, shape.id)).toThrow(/frameId/);
  });

  it('rejects a parented remote frame without letting unrelated remote faults hide a valid target', () => {
    const store = new ElementStore();
    const valid = createFrame({ position: { x: 0, y: 0 }, size: { w: 80, h: 48 } });
    valid.id = 'valid';
    const invalid = createFrame({ position: { x: 100, y: 0 }, size: { w: 80, h: 48 } });
    invalid.id = 'invalid';
    invalid.parentId = 'missing-parent';
    store.add(valid);
    store.add(invalid, { origin: 'remote' });

    expect(resolveFrameExport(store, valid.id)?.region).toEqual({ x: 0, y: 24, w: 80, h: 24 });
    expect(() => resolveFrameExport(store, invalid.id)).toThrow(/frameId/);
  });

  it('rejects a frame adapter whose clip bounds are null', () => {
    const store = new ElementStore();
    const frame = createFrame({ position: { x: 0, y: 0 }, size: { w: 80, h: 48 } });
    const adapter = store.elementRegistry.getAdapter(frame.extensionType);
    if (!adapter?.clipBounds) throw new Error('Frame adapter has no clip bounds');
    const clipBounds = vi.spyOn(adapter, 'clipBounds').mockReturnValue(null);

    try {
      store.add(frame);
      expect(() => resolveFrameExport(store, frame.id)).toThrow(RangeError);
      expect(() => resolveFrameExport(store, frame.id)).toThrow(/frameId/);
    } finally {
      clipBounds.mockRestore();
    }
  });
});
