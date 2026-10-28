// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { SelectionOps } from './selection-ops';
import { ElementStore } from '../elements/element-store';
import { HistoryStack } from '../history/history-stack';
import { HistoryRecorder } from '../history/history-recorder';
import type { ExtensionElementEnvelope } from '../elements/types';
import {
  createShape,
  createArrow,
  createStroke,
  createText,
  createImage,
} from '../elements/element-factory';
import { createTestBoxRegistry } from '../test-helpers/test-box-type';
import { createFrame } from '../elements/frame-element';
import { ElementRegistry } from '../elements/element-registry';

function setup(selectedIds: string[] = []) {
  const store = new ElementStore();
  const stack = new HistoryStack();
  const recorder = new HistoryRecorder(store, stack);
  const requestRender = vi.fn();
  const ops = new SelectionOps({
    store,
    recorder,
    getSelectedIds: () => selectedIds,
    requestRender,
  });
  return { store, stack, recorder, requestRender, ops };
}

describe('SelectionOps', () => {
  it('align() moves extension elements by the bounds of its element registry', () => {
    const elementRegistry = createTestBoxRegistry();
    const box = (id: string, x: number): ExtensionElementEnvelope => ({
      id,
      type: 'extension',
      extensionType: 'test:box',
      position: { x, y: 0 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId: '',
      data: {},
    });
    const store = new ElementStore(elementRegistry);
    const ops = new SelectionOps({
      store,
      recorder: new HistoryRecorder(store, new HistoryStack()),
      getSelectedIds: () => ['a', 'b'],
      requestRender: vi.fn(),
      elementRegistry,
    });
    store.add(box('a', 10));
    store.add(box('b', 50));

    ops.align('left');

    expect(store.getById('b')?.position).toEqual({ x: 10, y: 0 });
  });

  it('group() sets a shared groupId on selected elements in one undo step', () => {
    const a = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    const b = createShape({ position: { x: 50, y: 0 }, size: { w: 10, h: 10 } });
    const { store, stack, ops } = setup([a.id, b.id]);
    store.add(a);
    store.add(b);
    const baseline = stack.undoCount;

    ops.group();

    const groupA = store.getById(a.id)?.groupId;
    const groupB = store.getById(b.id)?.groupId;
    expect(groupA).toBeDefined();
    expect(groupA).toBe(groupB);
    expect(stack.undoCount).toBe(baseline + 1);
  });

  it('toggleLock() locks all when any unlocked', () => {
    const a = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, locked: true });
    const b = createShape({ position: { x: 50, y: 0 }, size: { w: 10, h: 10 } });
    const { store, ops } = setup([a.id, b.id]);
    store.add(a);
    store.add(b);

    ops.toggleLock();

    expect(store.getById(a.id)?.locked).toBe(true);
    expect(store.getById(b.id)?.locked).toBe(true);
  });

  it('getStyle() returns null on empty selection', () => {
    const { ops } = setup([]);
    expect(ops.getStyle()).toBeNull();
  });

  it('getStyle() returns a shared color when both elements share it', () => {
    const a = createShape({
      position: { x: 0, y: 0 },
      size: { w: 10, h: 10 },
      strokeColor: '#ff0000',
    });
    const b = createShape({
      position: { x: 50, y: 0 },
      size: { w: 10, h: 10 },
      strokeColor: '#ff0000',
    });
    const { store, ops } = setup([a.id, b.id]);
    store.add(a);
    store.add(b);

    expect(ops.getStyle()?.color).toBe('#ff0000');
  });

  describe('getStyleDetails', () => {
    function setupDynamic() {
      const selectedIds: string[] = [];
      const store = new ElementStore();
      const stack = new HistoryStack();
      const recorder = new HistoryRecorder(store, stack);
      const requestRender = vi.fn();
      const ops = new SelectionOps({
        store,
        recorder,
        getSelectedIds: () => selectedIds,
        requestRender,
      });

      const addShape = (opts: Parameters<typeof createShape>[0]) => {
        const el = createShape(opts);
        store.add(el);
        return el;
      };

      const addStroke = (opts: Parameters<typeof createStroke>[0]) => {
        const el = createStroke(opts);
        store.add(el);
        return el;
      };

      const setSelected = (ids: string[]) => {
        selectedIds.length = 0;
        selectedIds.push(...ids);
      };

      return { store, stack, recorder, requestRender, ops, addShape, addStroke, setSelected };
    }

    it('returns null for empty selection', () => {
      const { ops, setSelected } = setupDynamic();
      setSelected([]);
      expect(ops.getStyleDetails()).toBeNull();
    });

    it('returns null for stale-only selection', () => {
      const { ops, setSelected } = setupDynamic();
      setSelected(['ghost-id']);
      expect(ops.getStyleDetails()).toBeNull();
    });

    it('heterogeneous colors: applicable + mixed, absent from common', () => {
      const { ops, addShape, setSelected } = setupDynamic();
      const a = addShape({
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        strokeColor: '#ff0000',
      });
      const b = addShape({
        position: { x: 50, y: 0 },
        size: { w: 10, h: 10 },
        strokeColor: '#00ff00',
      });
      setSelected([a.id, b.id]);
      const d = ops.getStyleDetails();
      expect(d?.applicable).toContain('color');
      expect(d?.mixed).toContain('color');
      expect(d?.common.color).toBeUndefined();
    });

    it('uniform values: common matches getStyle(), mixed empty for that field', () => {
      const { ops, addShape, setSelected } = setupDynamic();
      const a = addShape({
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        strokeColor: '#ff0000',
      });
      const b = addShape({
        position: { x: 50, y: 0 },
        size: { w: 10, h: 10 },
        strokeColor: '#ff0000',
      });
      setSelected([a.id, b.id]);
      const d = ops.getStyleDetails();
      expect(d?.common).toEqual(ops.getStyle());
      expect(d?.mixed).not.toContain('color');
    });

    it('type-disjoint selection unions applicability', () => {
      const { ops, addShape, addStroke, setSelected } = setupDynamic();
      const stroke = addStroke({
        position: { x: 0, y: 0 },
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 10, y: 10, pressure: 0.5 },
        ],
        width: 4,
      });
      const shape = addShape({
        position: { x: 50, y: 0 },
        size: { w: 10, h: 10 },
        fillColor: '#123456',
      });
      setSelected([stroke.id, shape.id]);
      const d = ops.getStyleDetails();
      expect(d?.applicable).toContain('strokeWidth');
      expect(d?.applicable).toContain('fillColor');
    });

    it('heterogeneous widths are mixed', () => {
      const { ops, addShape, setSelected } = setupDynamic();
      const a = addShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, strokeWidth: 2 });
      const b = addShape({ position: { x: 50, y: 0 }, size: { w: 10, h: 10 }, strokeWidth: 8 });
      setSelected([a.id, b.id]);
      expect(ops.getStyleDetails()?.mixed).toContain('strokeWidth');
    });

    it('heterogeneous font sizes are mixed', () => {
      const setupTextDynamic = () => {
        const selectedIds: string[] = [];
        const store = new ElementStore();
        const stack = new HistoryStack();
        const recorder = new HistoryRecorder(store, stack);
        const requestRender = vi.fn();
        const ops = new SelectionOps({
          store,
          recorder,
          getSelectedIds: () => selectedIds,
          requestRender,
        });
        const addText = (opts: Parameters<typeof createText>[0]) => {
          const el = createText(opts);
          store.add(el);
          return el;
        };
        const setSelected = (ids: string[]) => {
          selectedIds.length = 0;
          selectedIds.push(...ids);
        };
        return { ops, addText, setSelected };
      };
      const { ops, addText, setSelected } = setupTextDynamic();
      const a = addText({ position: { x: 0, y: 0 }, text: 'small', fontSize: 12 });
      const b = addText({ position: { x: 50, y: 0 }, text: 'large', fontSize: 24 });
      setSelected([a.id, b.id]);
      const d = ops.getStyleDetails();
      expect(d?.mixed).toContain('fontSize');
      expect(d?.common.fontSize).toBeUndefined();
    });

    it('applyStyle on a mixed selection normalizes all supporting elements in one transaction', () => {
      const { ops, addShape, setSelected } = setupDynamic();
      const a = addShape({
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        strokeColor: '#ff0000',
      });
      const b = addShape({
        position: { x: 50, y: 0 },
        size: { w: 10, h: 10 },
        strokeColor: '#00ff00',
      });
      setSelected([a.id, b.id]);
      ops.applyStyle({ color: '#0000ff' });
      const d = ops.getStyleDetails();
      expect(d?.common.color).toBe('#0000ff');
      expect(d?.mixed).not.toContain('color');
    });

    it('returns null when the selection has no applicable style field, unlike getStyle()', () => {
      const { store, ops, setSelected } = setupDynamic();
      const image = createImage({
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        src: 'data:image/png;base64,',
      });
      store.add(image);
      setSelected([image.id]);

      expect(ops.getStyleDetails()).toBeNull();
      expect(ops.getStyle()).toEqual({});
    });

    it('partial definition: one element defines fillColor, the other does not', () => {
      const { ops, addShape, addStroke, setSelected } = setupDynamic();
      const stroke = addStroke({
        position: { x: 0, y: 0 },
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 10, y: 10, pressure: 0.5 },
        ],
      });
      const shape = addShape({
        position: { x: 50, y: 0 },
        size: { w: 10, h: 10 },
        fillColor: '#123456',
      });
      setSelected([stroke.id, shape.id]);
      const d = ops.getStyleDetails();
      expect(d?.applicable).toContain('fillColor');
      expect(d?.mixed).not.toContain('fillColor');
      expect(d?.common.fillColor).toBe('#123456');
      expect(d?.common).toEqual(ops.getStyle());
    });
  });
});

describe('hierarchy-aware transforms', () => {
  it('aligns selected frame closures once and restores them in one undo step', () => {
    const frame = {
      ...createFrame({ position: { x: 100, y: 0 }, size: { w: 120, h: 90 } }),
      id: 'frame',
    };
    const child = {
      ...createShape({ position: { x: 130, y: 40 }, size: { w: 20, h: 20 } }),
      id: 'child',
      parentId: frame.id,
    };
    const other = {
      ...createShape({ position: { x: 10, y: 0 }, size: { w: 20, h: 20 } }),
      id: 'other',
    };
    const { store, stack, ops } = setup([child.id, other.id, frame.id]);
    store.add(frame);
    store.add(child);
    store.add(other);
    const baseline = stack.undoCount;

    ops.align('left');

    expect(store.getById(frame.id)?.position).toEqual({ x: 10, y: 0 });
    expect(store.getById(child.id)?.position).toEqual({ x: 40, y: 40 });
    expect(store.getVersion(child.id)).toBe(1);
    expect(stack.undoCount).toBe(baseline + 1);
    stack.undo(store);
    expect(store.getById(frame.id)?.position).toEqual({ x: 100, y: 0 });
    expect(store.getById(child.id)?.position).toEqual({ x: 130, y: 40 });
  });

  it('distributes root closures by root centers without translating selected descendants twice', () => {
    const first = {
      ...createFrame({ position: { x: 0, y: 0 }, size: { w: 80, h: 60 } }),
      id: 'first',
    };
    const middle = {
      ...createFrame({ position: { x: 200, y: 0 }, size: { w: 80, h: 60 } }),
      id: 'middle',
    };
    const last = {
      ...createShape({ position: { x: 500, y: 0 }, size: { w: 20, h: 20 } }),
      id: 'last',
    };
    const firstChild = {
      ...createShape({ position: { x: 10, y: 30 }, size: { w: 10, h: 10 } }),
      id: 'first-child',
      parentId: first.id,
    };
    const middleChild = {
      ...createShape({ position: { x: 210, y: 30 }, size: { w: 10, h: 10 } }),
      id: 'middle-child',
      parentId: middle.id,
    };
    const { store, ops } = setup([firstChild.id, last.id, middle.id, middleChild.id, first.id]);
    for (const element of [first, middle, last, firstChild, middleChild]) store.add(element);

    ops.distribute('horizontal');

    expect(store.getById(first.id)?.position).toEqual({ x: 0, y: 0 });
    expect(store.getById(middle.id)?.position).toEqual({ x: 235, y: 0 });
    expect(store.getById(middleChild.id)?.position).toEqual({ x: 245, y: 30 });
    expect(store.getVersion(middleChild.id)).toBe(1);
    expect(store.getById(last.id)?.position).toEqual({ x: 500, y: 0 });
  });

  it('reanchors external arrows once without refreshing arrows inside a moved closure', () => {
    const frame = {
      ...createFrame({ position: { x: 100, y: 0 }, size: { w: 120, h: 90 } }),
      id: 'frame',
    };
    const child = {
      ...createShape({ position: { x: 130, y: 40 }, size: { w: 20, h: 20 } }),
      id: 'child',
      parentId: frame.id,
    };
    const internal = {
      ...createArrow({
        from: { x: 130, y: 50 },
        to: { x: 150, y: 50 },
        parentId: frame.id,
        fromBinding: { elementId: child.id },
      }),
      id: 'internal',
    };
    const external = {
      ...createArrow({
        from: { x: 0, y: 50 },
        to: { x: 130, y: 50 },
        toBinding: { elementId: child.id },
      }),
      id: 'external',
    };
    const other = {
      ...createShape({ position: { x: 10, y: 0 }, size: { w: 20, h: 20 } }),
      id: 'other',
    };
    const { store, ops } = setup([frame.id, child.id, other.id]);
    for (const element of [frame, child, internal, external, other]) store.add(element);

    ops.align('left');

    expect(store.getVersion(internal.id)).toBe(1);
    expect(store.getVersion(external.id)).toBe(1);
    expect(store.getById(external.id)).toMatchObject({ to: { x: 50, y: 50 } });
  });

  it('excludes locked root subtrees from alignment bounds with or without a selected child', () => {
    const run = (includeChild: boolean) => {
      const locked = {
        ...createFrame({ position: { x: 0, y: 0 }, size: { w: 120, h: 90 }, locked: true }),
        id: 'locked',
      };
      const child = {
        ...createShape({ position: { x: 30, y: 40 }, size: { w: 20, h: 20 } }),
        id: 'child',
        parentId: locked.id,
      };
      const a = { ...createShape({ position: { x: 100, y: 0 }, size: { w: 20, h: 20 } }), id: 'a' };
      const b = { ...createShape({ position: { x: 150, y: 0 }, size: { w: 20, h: 20 } }), id: 'b' };
      const { store, ops } = setup(
        includeChild ? [locked.id, child.id, a.id, b.id] : [locked.id, a.id, b.id],
      );
      for (const element of [locked, child, a, b]) store.add(element);
      ops.align('left');
      return { store, locked, child, a, b };
    };

    for (const { store, locked, child, a, b } of [run(false), run(true)]) {
      expect(store.getById(locked.id)?.position).toEqual({ x: 0, y: 0 });
      expect(store.getById(child.id)?.position).toEqual({ x: 30, y: 40 });
      expect(store.getById(a.id)?.position).toEqual({ x: 100, y: 0 });
      expect(store.getById(b.id)?.position).toEqual({ x: 100, y: 0 });
    }
  });

  it('requires three eligible roots to distribute when a locked root is selected', () => {
    const locked = {
      ...createFrame({ position: { x: 0, y: 0 }, size: { w: 120, h: 90 }, locked: true }),
      id: 'locked',
    };
    const a = { ...createShape({ position: { x: 100, y: 0 }, size: { w: 20, h: 20 } }), id: 'a' };
    const b = { ...createShape({ position: { x: 300, y: 0 }, size: { w: 20, h: 20 } }), id: 'b' };
    const { store, stack, ops } = setup([locked.id, a.id, b.id]);
    for (const element of [locked, a, b]) store.add(element);
    const baseline = stack.undoCount;

    ops.distribute('horizontal');

    expect(store.getById(a.id)?.position).toEqual({ x: 100, y: 0 });
    expect(store.getById(b.id)?.position).toEqual({ x: 300, y: 0 });
    expect(stack.undoCount).toBe(baseline);
  });
});

describe('rotateSelection', () => {
  it('excludes frames from the pivot and leaves frame-only selections untouched', () => {
    const a = { ...createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }), id: 'a' };
    const b = { ...createShape({ position: { x: 90, y: 0 }, size: { w: 10, h: 10 } }), id: 'b' };
    const frame = {
      ...createFrame({ position: { x: 1000, y: 1000 }, size: { w: 120, h: 90 } }),
      id: 'frame',
    };
    const { store, stack, ops, requestRender } = setup([a.id, frame.id, b.id]);
    for (const element of [a, b, frame]) store.add(element);
    const storedFrame = store.getById(frame.id);
    const baseline = stack.undoCount;

    ops.rotateSelection('cw');

    expect(store.getById(a.id)).toMatchObject({
      position: { x: 45, y: -45 },
      rotation: Math.PI / 2,
    });
    expect(store.getById(b.id)).toMatchObject({
      position: { x: 45, y: 45 },
      rotation: Math.PI / 2,
    });
    expect(store.getById(frame.id)).toEqual(storedFrame);
    expect(store.getVersion(frame.id)).toBe(0);
    expect(stack.undoCount).toBe(baseline + 1);
    expect(requestRender).toHaveBeenCalledOnce();

    const frameOnly = setup([frame.id]);
    frameOnly.store.add(frame);
    const frameOnlyBaseline = frameOnly.stack.undoCount;
    frameOnly.ops.rotateSelection('cw');
    expect(frameOnly.stack.undoCount).toBe(frameOnlyBaseline);
    expect(frameOnly.requestRender).not.toHaveBeenCalled();
  });

  it('keeps registered non-frame extension rotation adapters eligible with frames', () => {
    const registry = new ElementRegistry();
    registry.register<ExtensionElementEnvelope>({
      type: 'test:rotatable',
      legacyTypes: [],
      decodeLegacy: (raw) => raw as ExtensionElementEnvelope,
      validateData: () => true,
      unwrap: (element) => element,
      wrap: (element) => element,
      bounds: (element) => ({ x: element.position.x, y: element.position.y, w: 10, h: 10 }),
      interaction: {
        rotate: (element, _pivot, delta) => ({
          ...element,
          position: { x: element.position.x + delta, y: element.position.y },
        }),
      },
      renderMode: 'canvas',
    });
    const extension: ExtensionElementEnvelope = {
      id: 'extension',
      type: 'extension',
      extensionType: 'test:rotatable',
      position: { x: 0, y: 0 },
      index: 'a',
      version: 1,
      locked: false,
      layerId: '',
      data: {},
    };
    const frame = {
      ...createFrame({ position: { x: 1000, y: 1000 }, size: { w: 120, h: 90 } }),
      id: 'frame',
    };
    const store = new ElementStore(registry);
    const ops = new SelectionOps({
      store,
      recorder: new HistoryRecorder(store, new HistoryStack()),
      getSelectedIds: () => [frame.id, extension.id],
      requestRender: vi.fn(),
      elementRegistry: registry,
    });
    store.add(frame);
    store.add(extension);
    const storedFrame = store.getById(frame.id);

    ops.rotateSelection('cw');

    expect(store.getById(extension.id)?.position.x).toBeCloseTo(Math.PI / 2);
    expect(store.getById(frame.id)).toEqual(storedFrame);
  });

  it('single rotatable element: +π/2 rotation, position unchanged, one undo step', () => {
    const a = createShape({ position: { x: 10, y: 20 }, size: { w: 40, h: 20 } });
    const { store, stack, ops, requestRender } = setup([a.id]);
    store.add(a);
    const baseline = stack.undoCount;

    ops.rotateSelection('cw');

    const el = store.getById(a.id);
    expect(el?.rotation).toBeCloseTo(Math.PI / 2);
    expect(el?.position.x).toBeCloseTo(10);
    expect(el?.position.y).toBeCloseTo(20);
    expect(stack.undoCount).toBe(baseline + 1);
    expect(requestRender).toHaveBeenCalled();
  });

  it('ccw rotates negative', () => {
    const a = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    const { store, ops } = setup([a.id]);
    store.add(a);

    ops.rotateSelection('ccw');

    expect(store.getById(a.id)?.rotation).toBeCloseTo(-Math.PI / 2);
  });

  it('multi-select: rigid group turn about union center, one undo step', () => {
    // a: 10x10 at (0,0); b: 10x10 at (90,0). Union x:[0,100] y:[0,10], pivot (50,5).
    // CW about (50,5): a-center (5,5) → (50,-40) → position (45,-45); b-center (95,5) → (50,50).
    const a = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    const b = createShape({ position: { x: 90, y: 0 }, size: { w: 10, h: 10 } });
    const { store, stack, ops } = setup([a.id, b.id]);
    store.add(a);
    store.add(b);
    const baseline = stack.undoCount;

    ops.rotateSelection('cw');

    const ra = store.getById(a.id);
    const rb = store.getById(b.id);
    expect(ra?.position.x).toBeCloseTo(45);
    expect(ra?.position.y).toBeCloseTo(-45);
    expect(rb?.position.x).toBeCloseTo(45);
    expect(rb?.position.y).toBeCloseTo(45);
    expect(ra?.rotation).toBeCloseTo(Math.PI / 2);
    expect(rb?.rotation).toBeCloseTo(Math.PI / 2);
    expect(stack.undoCount).toBe(baseline + 1);
  });

  it('undo restores positions and rotations exactly', () => {
    const a = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    const b = createShape({ position: { x: 90, y: 0 }, size: { w: 10, h: 10 } });
    const { store, stack, ops } = setup([a.id, b.id]);
    store.add(a);
    store.add(b);

    ops.rotateSelection('cw');
    stack.undo(store);

    const ra = store.getById(a.id);
    expect(ra?.position).toEqual({ x: 0, y: 0 });
    expect(ra?.rotation ?? 0).toBe(0);
    expect(store.getById(b.id)?.position).toEqual({ x: 90, y: 0 });
  });

  it('locked elements are skipped; pivot from eligible only', () => {
    const locked = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, locked: true });
    const free = createShape({ position: { x: 50, y: 50 }, size: { w: 10, h: 10 } });
    const { store, ops } = setup([locked.id, free.id]);
    store.add(locked);
    store.add(free);

    ops.rotateSelection('cw');

    expect(store.getById(locked.id)?.rotation ?? 0).toBe(0);
    expect(store.getById(locked.id)?.position).toEqual({ x: 0, y: 0 });
    // free is the only eligible → spins in place about own center
    expect(store.getById(free.id)?.rotation).toBeCloseTo(Math.PI / 2);
    expect(store.getById(free.id)?.position.x).toBeCloseTo(50);
  });

  it('no-op when nothing eligible: no history entry', () => {
    const locked = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, locked: true });
    const { store, stack, ops, requestRender } = setup([locked.id]);
    store.add(locked);
    const baseline = stack.undoCount;

    ops.rotateSelection('cw');

    expect(stack.undoCount).toBe(baseline);
    expect(requestRender).not.toHaveBeenCalled();
  });

  it('unbound arrow in selection rotates endpoints; bound arrow skipped but re-anchored', () => {
    const target = createShape({ position: { x: 100, y: 100 }, size: { w: 20, h: 20 } });
    const bound = createArrow({
      from: { x: 0, y: 110 },
      to: { x: 100, y: 110 },
      toBinding: { elementId: target.id },
    });
    const loose = createArrow({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 } });
    const { store, ops } = setup([target.id, bound.id, loose.id]);
    store.add(target);
    store.add(bound);
    store.add(loose);
    const boundToBefore = store.getById(bound.id);
    const looseBefore = store.getById(loose.id);
    if (boundToBefore?.type !== 'arrow' || looseBefore?.type !== 'arrow') throw new Error('setup');
    const boundToOld = { ...boundToBefore.to };

    ops.rotateSelection('cw');

    const looseAfter = store.getById(loose.id);
    if (looseAfter?.type !== 'arrow') throw new Error('arrow expected');
    expect(looseAfter.to).not.toEqual(looseBefore.to);
    const boundAfter = store.getById(bound.id);
    if (boundAfter?.type !== 'arrow') throw new Error('arrow expected');
    // re-anchored to the rotated target, not left where it was
    expect(boundAfter.to).not.toEqual(boundToOld);
  });

  it('lone selected arrow orbits its own bbox center', () => {
    // bbox of (0,0)-(10,0) is x:[0,10] y:[0,0], center (5,0).
    // y-down CW: (x,y)-pivot -> (-dy,dx)+pivot. from (0,0): d=(-5,0) -> (0,-5) -> (5,-5).
    // to (10,0): d=(5,0) -> (0,5) -> (5,5).
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 } });
    const { store, ops } = setup([arrow.id]);
    store.add(arrow);

    ops.rotateSelection('cw');

    const el = store.getById(arrow.id);
    if (el?.type !== 'arrow') throw new Error('arrow expected');
    expect(el.from.x).toBeCloseTo(5);
    expect(el.from.y).toBeCloseTo(-5);
    expect(el.to.x).toBeCloseTo(5);
    expect(el.to.y).toBeCloseTo(5);
  });

  it('empty selection is a no-op', () => {
    const { stack, ops } = setup([]);
    const baseline = stack.undoCount;
    ops.rotateSelection('cw');
    expect(stack.undoCount).toBe(baseline);
  });
});
