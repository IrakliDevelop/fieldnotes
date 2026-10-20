/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Viewport } from './viewport';
import { SelectTool } from '../tools/select-tool';
import { PencilTool } from '../tools/pencil-tool';
import { createNote, createShape } from '../elements/element-factory';
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
  createToolOptionsSource,
} from './viewport-sources';
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

describe('createToolOptionsSource', () => {
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
