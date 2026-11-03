/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Viewport } from './viewport';
import { SelectTool } from '../tools/select-tool';
import { PencilTool } from '../tools/pencil-tool';
import { createNote, createShape } from '../elements/element-factory';
import { createFrame } from '../elements/frame-element';
import {
  createActiveToolSource,
  createCameraSource,
  createElementsSelectorSource,
  createElementsSource,
  createHistorySource,
  createLayersSource,
  createSelectionOpsSource,
  createSelectionSource,
  createSelectionStyleDetailsSource,
  createSelectionStyleSource,
  createShortcutsSource,
  createToolOptionsSource,
  createPresentationSource,
  createElementSource,
  createCanvasSizeSource,
  createPeersSource,
} from './viewport-sources';
import { PeerRoster } from './awareness-roster';
import { AWARENESS_PRESENCE_KIND } from './awareness-presence';
import type { CanvasElement, ElementType } from '../elements/types';
import type { Tool } from '../tools/types';

let container: HTMLDivElement;
let vp: Viewport;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  vp = new Viewport(container, { tools: [new SelectTool(), new PencilTool()] });
});

afterEach(() => {
  vp.destroy();
  container.remove();
});

function addNote(x = 0): string {
  const el = createNote({ position: { x, y: 0 } });
  vp.store.add(el);
  return el.id;
}

function select(ids: string[]): void {
  vp.toolManager.getTool<SelectTool>('select')?.setSelection(ids);
}

function counter(): { calls: number; onChange: () => void } {
  const c = {
    calls: 0,
    onChange: () => {
      c.calls++;
    },
  };
  return c;
}

const noopCommand = {
  execute: () => undefined,
  undo: () => undefined,
};

describe('createCameraSource', () => {
  it('starts from the React cache, keeps the reference until the camera moves', () => {
    const source = createCameraSource(vp);
    const first = source.getSnapshot();
    expect(first).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(source.getSnapshot()).toBe(first);
    vp.camera.pan(10, 20);
    const moved = source.getSnapshot();
    expect(moved).toEqual({ x: 10, y: 20, zoom: 1 });
    expect(moved).not.toBe(first);
  });

  it('notifies on camera change until unsubscribed', () => {
    const source = createCameraSource(vp);
    const c = counter();
    const off = source.subscribe(c.onChange);
    vp.camera.pan(5, 0);
    expect(c.calls).toBe(1);
    off();
    vp.camera.pan(5, 0);
    expect(c.calls).toBe(1);
  });
});

describe('createElementsSource', () => {
  it('keeps the array reference until the store changes', () => {
    const source = createElementsSource(vp);
    const empty = source.getSnapshot();
    expect(empty).toEqual([]);
    expect(source.getSnapshot()).toBe(empty);
    const id = addNote();
    const next = source.getSnapshot();
    expect(next.map((el) => el.id)).toEqual([id]);
    expect(next).not.toBe(empty);
    expect(source.getSnapshot()).toBe(next);
  });

  it('filters by the type the getter returns at each snapshot', () => {
    let type: ElementType | undefined = 'note';
    const source = createElementsSource(vp, () => type);
    const noteId = addNote();
    const shape = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    vp.store.add(shape);
    expect(source.getSnapshot().map((el) => el.id)).toEqual([noteId]);
    type = 'shape';
    expect(source.getSnapshot().map((el) => el.id)).toEqual([shape.id]);
  });

  it('keeps the reference when a type switch yields the same elements', () => {
    let type: ElementType | undefined = 'note';
    const source = createElementsSource(vp, () => type);
    addNote();
    const notes = source.getSnapshot();
    type = undefined;
    expect(source.getSnapshot()).toBe(notes);
  });

  it('notifies on store change until unsubscribed', () => {
    const source = createElementsSource(vp);
    const c = counter();
    const off = source.subscribe(c.onChange);
    addNote();
    expect(c.calls).toBe(1);
    off();
    addNote();
    expect(c.calls).toBe(1);
  });
});

describe('createElementSource', () => {
  it('returns the element by id and null when absent', () => {
    const a = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    vp.store.add(a);

    expect(createElementSource(vp, () => a.id).getSnapshot()).toBe(vp.store.getById(a.id));
    expect(createElementSource(vp, () => 'missing').getSnapshot()).toBeNull();
    expect(createElementSource(vp, () => null).getSnapshot()).toBeNull();
  });

  it('keeps the reference until that element changes', () => {
    const a = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    const b = createShape({ position: { x: 20, y: 0 }, size: { w: 10, h: 10 } });
    vp.store.add(a);
    vp.store.add(b);
    const source = createElementSource(vp, () => a.id);
    const first = source.getSnapshot();

    vp.store.update(b.id, { position: { x: 25, y: 0 } });
    expect(source.getSnapshot()).toBe(first);
    vp.store.update(a.id, { position: { x: 5, y: 0 } });
    const updated = source.getSnapshot();
    expect(updated).toBe(vp.store.getById(a.id));
    if (updated === null) throw new Error('expected updated element');
    expect(updated.position.x).toBe(5);
    expect(updated).not.toBe(first);
  });
});

describe('createCanvasSizeSource', () => {
  let resizeVp: Viewport | null = null;
  let resizeContainer: HTMLDivElement | null = null;

  afterEach(() => {
    resizeVp?.destroy();
    resizeContainer?.remove();
    vi.unstubAllGlobals();
  });

  it('reads the canvas size and keeps the reference until it changes', () => {
    let callback: ResizeObserverCallback | undefined;
    const observers: ResizeObserver[] = [];
    class FakeResizeObserver implements ResizeObserver {
      constructor(next: ResizeObserverCallback) {
        callback = next;
        observers.push(this);
      }
      observe(_target: Element, _options?: ResizeObserverOptions): void {
        return undefined;
      }
      unobserve(_target: Element): void {
        return undefined;
      }
      disconnect(): void {
        return undefined;
      }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    resizeContainer = document.createElement('div');
    document.body.appendChild(resizeContainer);
    resizeVp = new Viewport(resizeContainer, { tools: [new SelectTool(), new PencilTool()] });
    const canvas = resizeVp.domLayer.parentElement?.querySelector('canvas');
    expect(canvas).not.toBeNull();
    if (!canvas) return;
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 300 });
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 200 });
    const source = createCanvasSizeSource(resizeVp);
    const first = source.getSnapshot();
    const observer = observers[0];

    expect(first).toEqual({ w: 300, h: 200 });
    expect(source.getSnapshot()).toBe(first);
    const changed = counter();
    const off = source.subscribe(changed.onChange);
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 400 });
    if (!callback || !observer) throw new Error('expected ResizeObserver callback');
    callback([], observer);
    expect(changed.calls).toBe(1);
    expect(source.getSnapshot()).toEqual({ w: 400, h: 200 });
    expect(source.getSnapshot()).not.toBe(first);
    off();
    callback([], observer);
    expect(changed.calls).toBe(1);
  });
});

describe('createPeersSource', () => {
  it('forwards the roster snapshot and lifecycle', () => {
    const roster = new PeerRoster();
    roster.apply('p1', {
      kind: AWARENESS_PRESENCE_KIND,
      id: 'u1',
      name: 'Ann',
      color: '#f00',
    });
    const source = createPeersSource(roster);
    const snapshot = source.getSnapshot();

    expect(snapshot).toBe(roster.getPeers());
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({ from: 'p1', id: 'u1', name: 'Ann', color: '#f00' });
    const changed = counter();
    const off = source.subscribe(changed.onChange);
    roster.remove('p1');
    expect(changed.calls).toBe(1);
    off();
    roster.apply('p1', { kind: AWARENESS_PRESENCE_KIND, id: 'u1', name: 'Ann', color: '#f00' });
    expect(changed.calls).toBe(1);
    roster.dispose();
  });
});

describe('createElementsSelectorSource', () => {
  const ids = (els: CanvasElement[]): string[] => els.map((el) => el.id);

  it('returns the previous reference for a shallow-equal selection', () => {
    const source = createElementsSelectorSource(vp, () => ids);
    const a = source.getSnapshot();
    expect(source.getSnapshot()).toBe(a);
    const id = addNote();
    const b = source.getSnapshot();
    expect(b).toEqual([id]);
    expect(b).not.toBe(a);
  });

  it('keeps the cached reference when the getter swaps to an equivalent selector', () => {
    let selector = ids;
    const source = createElementsSelectorSource(vp, () => selector);
    addNote();
    const first = source.getSnapshot();
    selector = (els) => els.map((el) => el.id);
    expect(source.getSnapshot()).toBe(first);
  });

  it('uses the isEqual the getter returns', () => {
    const source = createElementsSelectorSource(
      vp,
      () => (els) => ({ count: els.length }),
      () => () => false,
    );
    expect(source.getSnapshot()).not.toBe(source.getSnapshot());
  });
});

describe('createSelectionSource', () => {
  it('reflects the selection and notifies until unsubscribed', () => {
    const source = createSelectionSource(vp);
    const c = counter();
    const off = source.subscribe(c.onChange);
    const before = source.getSnapshot();
    expect(source.getSnapshot()).toBe(before);
    const id = addNote();
    select([id]);
    expect(c.calls).toBe(1);
    expect(source.getSnapshot()).toEqual([id]);
    off();
    select([]);
    expect(c.calls).toBe(1);
  });
});

describe('createSelectionOpsSource', () => {
  it('reports empty defaults and a stable reference', () => {
    const source = createSelectionOpsSource(vp);
    const snap = source.getSnapshot();
    expect(snap).toEqual({
      selectedIds: [],
      canGroup: false,
      canUngroup: false,
      canAlign: false,
      canDistribute: false,
      isLocked: null,
    });
    expect(source.getSnapshot()).toBe(snap);
  });

  it('allows distribute only at three or more', () => {
    const source = createSelectionOpsSource(vp);
    const a = addNote(0);
    const b = addNote(100);
    const c = addNote(200);
    select([a, b]);
    const two = source.getSnapshot();
    expect(two).toMatchObject({ canGroup: true, canAlign: true, canDistribute: false });
    select([a, b, c]);
    expect(source.getSnapshot()).toMatchObject({ canDistribute: true });
  });

  it('isLocked is null on a mixed selection and true when uniformly locked', () => {
    const source = createSelectionOpsSource(vp);
    const a = addNote(0);
    const b = addNote(100);
    vp.store.update(a, { locked: true });
    select([a, b]);
    expect(source.getSnapshot().isLocked).toBeNull();
    vp.store.update(b, { locked: true });
    expect(source.getSnapshot().isLocked).toBe(true);
  });

  it('notifies on selection and store changes until unsubscribed', () => {
    const source = createSelectionOpsSource(vp);
    const c = counter();
    const off = source.subscribe(c.onChange);
    const id = addNote();
    select([id]);
    expect(c.calls).toBe(2);
    off();
    addNote();
    select([]);
    expect(c.calls).toBe(2);
  });
});

describe('createSelectionStyleSource', () => {
  it('is null with no selection and keeps the reference for equal styles', () => {
    const source = createSelectionStyleSource(vp);
    expect(source.getSnapshot()).toBeNull();
    const id = addNote();
    select([id]);
    const style = source.getSnapshot();
    expect(style).not.toBeNull();
    expect(source.getSnapshot()).toBe(style);
    vp.applyStyleToSelection({ color: '#ff0000' });
    const next = source.getSnapshot();
    expect(next?.color).toBe('#ff0000');
    expect(next).not.toBe(style);
  });

  it('notifies on selection and store changes until unsubscribed', () => {
    const source = createSelectionStyleSource(vp);
    const c = counter();
    const off = source.subscribe(c.onChange);
    const id = addNote();
    select([id]);
    expect(c.calls).toBe(2);
    off();
    addNote();
    expect(c.calls).toBe(2);
  });
});

describe('createSelectionStyleDetailsSource', () => {
  it('is null with no selection and keeps the reference for equal details', () => {
    const source = createSelectionStyleDetailsSource(vp);
    expect(source.getSnapshot()).toBeNull();
    const id = addNote();
    select([id]);
    const details = source.getSnapshot();
    expect(details).not.toBeNull();
    expect(source.getSnapshot()).toBe(details);
    vp.applyStyleToSelection({ color: '#ff0000' });
    const next = source.getSnapshot();
    expect(next?.common.color).toBe('#ff0000');
    expect(next).not.toBe(details);
  });

  it('notifies on selection and store changes until unsubscribed', () => {
    const source = createSelectionStyleDetailsSource(vp);
    const c = counter();
    const off = source.subscribe(c.onChange);
    const id = addNote();
    select([id]);
    expect(c.calls).toBe(2);
    off();
    addNote();
    expect(c.calls).toBe(2);
  });
});

describe('createHistorySource', () => {
  it('changes reference only when undo/redo availability changes', () => {
    const source = createHistorySource(vp);
    const c = counter();
    const off = source.subscribe(c.onChange);
    const initial = source.getSnapshot();
    expect(initial).toEqual({ canUndo: false, canRedo: false });
    expect(source.getSnapshot()).toBe(initial);
    vp.history.push(noopCommand);
    expect(c.calls).toBe(1);
    const pushed = source.getSnapshot();
    expect(pushed).toEqual({ canUndo: true, canRedo: false });
    expect(pushed).not.toBe(initial);
    off();
    vp.undo();
    expect(c.calls).toBe(1);
    expect(source.getSnapshot()).toEqual({ canUndo: false, canRedo: true });
  });
});

describe('createLayersSource', () => {
  it('keeps the reference until a layer field changes', () => {
    const source = createLayersSource(vp);
    const c = counter();
    const off = source.subscribe(c.onChange);
    const first = source.getSnapshot();
    const layer = first.layers[0];
    expect(layer).toBeDefined();
    expect(first.activeLayerId).toBe(layer?.id);
    expect(source.getSnapshot()).toBe(first);
    vp.layerManager.renameLayer(layer?.id ?? '', 'Renamed');
    expect(c.calls).toBe(1);
    const renamed = source.getSnapshot();
    expect(renamed.layers[0]?.name).toBe('Renamed');
    expect(renamed).not.toBe(first);
    off();
    vp.layerManager.createLayer('Other');
    expect(c.calls).toBe(1);
  });
});

describe('createActiveToolSource', () => {
  it('reports the active tool name and notifies until unsubscribed', () => {
    const source = createActiveToolSource(vp);
    const c = counter();
    const off = source.subscribe(c.onChange);
    expect(source.getSnapshot()).toBe('select');
    vp.setTool('pencil');
    expect(c.calls).toBe(1);
    expect(source.getSnapshot()).toBe('pencil');
    off();
    vp.setTool('select');
    expect(c.calls).toBe(1);
  });

  it('is the empty string with no active tool', () => {
    const bare = new Viewport(document.createElement('div'), { tools: [] });
    expect(createActiveToolSource(bare).getSnapshot()).toBe('');
    bare.destroy();
  });
});

describe('createShortcutsSource', () => {
  it('returns the same reference until a binding changes', () => {
    const source = createShortcutsSource(vp);
    const first = source.getSnapshot();

    expect(source.getSnapshot()).toBe(first);
    vp.shortcuts.rebind('edit.undo', 'mod+u');
    const changed = source.getSnapshot();

    expect(changed).not.toBe(first);
    expect(changed['edit.undo']).toEqual(['mod+u']);
  });

  it('notifies subscribers on rebind', () => {
    const source = createShortcutsSource(vp);
    const changed = counter();
    source.subscribe(changed.onChange);

    vp.shortcuts.rebind('edit.undo', 'mod+u');

    expect(changed.calls).toBe(1);
  });
});

describe('createPresentationSource', () => {
  it('keeps its snapshot until the presentation changes', () => {
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 800 });
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 600 });
    vp.store.add(createFrame({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } }));
    const source = createPresentationSource(vp);
    const inactive = source.getSnapshot();
    expect(inactive).toEqual({ active: false, index: -1, count: 0, fullscreen: false });
    expect(source.getSnapshot()).toBe(inactive);

    const c = counter();
    const off = source.subscribe(c.onChange);
    expect(vp.presentation.start({ fullscreen: false, animate: false })).toBe(true);
    expect(c.calls).toBe(1);
    const active = source.getSnapshot();
    expect(active).toEqual({ active: true, index: 0, count: 1, fullscreen: false });
    expect(active).not.toBe(inactive);
    expect(vp.presentation.next()).toBe(false);
    expect(c.calls).toBe(1);
    expect(source.getSnapshot()).toBe(active);
    off();
    vp.presentation.exit();
    expect(c.calls).toBe(1);
  });
});

describe('createToolOptionsSource', () => {
  function createOptionsTool(name: string, size: number) {
    let options = { size };
    const listeners = new Set<() => void>();
    return {
      name,
      onPointerDown: () => undefined,
      onPointerMove: () => undefined,
      onPointerUp: () => undefined,
      getOptions: () => options,
      setOptions: (next: { size: number }) => {
        options = next;
        listeners.forEach((listener) => listener());
      },
      onOptionsChange: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }

  it('notifies when the named tool is registered after subscribing', () => {
    const source = createToolOptionsSource<{ size: number }>(vp, () => 'custom');
    const c = counter();
    source.subscribe(c.onChange);
    expect(source.getSnapshot()).toBeNull();

    vp.toolManager.register(createOptionsTool('custom', 4));

    expect(c.calls).toBe(1);
    expect(source.getSnapshot()).toEqual({ size: 4 });
  });

  it("follows the newly registered instance's option changes", () => {
    const source = createToolOptionsSource<{ size: number }>(vp, () => 'custom');
    const c = counter();
    source.subscribe(c.onChange);
    const custom = createOptionsTool('custom', 4);
    vp.toolManager.register(custom);

    custom.setOptions({ size: 6 });

    expect(c.calls).toBe(2);
    expect(source.getSnapshot()).toEqual({ size: 6 });
  });

  it('follows a replacement and detaches the previous instance', () => {
    const source = createToolOptionsSource<{ size: number }>(vp, () => 'custom');
    const c = counter();
    source.subscribe(c.onChange);
    const custom = createOptionsTool('custom', 4);
    vp.toolManager.register(custom);
    const replacement = createOptionsTool('custom', 6);
    vp.toolManager.register(replacement);

    custom.setOptions({ size: 8 });
    expect(c.calls).toBe(2);
    expect(source.getSnapshot()).toEqual({ size: 6 });

    replacement.setOptions({ size: 10 });

    expect(c.calls).toBe(3);
    expect(source.getSnapshot()).toEqual({ size: 10 });
  });

  it('unsubscribe removes both the register and options listener', () => {
    const source = createToolOptionsSource<{ size: number }>(vp, () => 'custom');
    const c = counter();
    const off = source.subscribe(c.onChange);
    const custom = createOptionsTool('custom', 4);
    vp.toolManager.register(custom);
    off();

    custom.setOptions({ size: 6 });
    vp.toolManager.register(createOptionsTool('custom', 12));

    expect(c.calls).toBe(1);
    expect(source.getSnapshot()).toEqual({ size: 12 });
  });

  it('ignores registrations of other tools', () => {
    const source = createToolOptionsSource<{ size: number }>(vp, () => 'custom');
    const c = counter();
    source.subscribe(c.onChange);

    vp.toolManager.register(createOptionsTool('eraser', 4));

    expect(c.calls).toBe(0);
  });

  it('keeps the reference until the tool options change', () => {
    const source = createToolOptionsSource<{ color: string }>(vp, () => 'pencil');
    const c = counter();
    const off = source.subscribe(c.onChange);
    const first = source.getSnapshot();
    expect(first).not.toBeNull();
    expect(source.getSnapshot()).toBe(first);
    vp.toolManager.getTool('pencil')?.setOptions?.({ color: '#ff0000' });
    expect(c.calls).toBe(1);
    const next = source.getSnapshot();
    expect(next?.color).toBe('#ff0000');
    expect(next).not.toBe(first);
    off();
    vp.toolManager.getTool('pencil')?.setOptions?.({ color: '#00ff00' });
    expect(c.calls).toBe(1);
  });

  it('is null for an unknown tool and subscribing is a no-op', () => {
    const source = createToolOptionsSource(vp, () => 'missing');
    expect(source.getSnapshot()).toBeNull();
    expect(() => source.subscribe(() => undefined)()).not.toThrow();
  });

  it('is null for a tool without getOptions and subscribing is a no-op', () => {
    const plain: Tool = {
      name: 'plain',
      onPointerDown: () => undefined,
      onPointerMove: () => undefined,
      onPointerUp: () => undefined,
    };
    vp.toolManager.register(plain);
    const source = createToolOptionsSource(vp, () => 'plain');
    expect(source.getSnapshot()).toBeNull();
    expect(() => source.subscribe(() => undefined)()).not.toThrow();
  });

  it('reads the tool name from the getter at snapshot and subscribe time', () => {
    let name = 'missing';
    const source = createToolOptionsSource<{ color: string }>(vp, () => name);
    expect(source.getSnapshot()).toBeNull();
    name = 'pencil';
    const c = counter();
    source.subscribe(c.onChange);
    expect(source.getSnapshot()).not.toBeNull();
    vp.toolManager.getTool('pencil')?.setOptions?.({ color: '#123456' });
    expect(c.calls).toBe(1);
  });
});
