/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Viewport } from './viewport';
import { SelectTool } from '../tools/select-tool';
import { createShape } from '../elements/element-factory';

function seedRect(viewport: Viewport, x = 0, y = 0): string {
  const el = createShape({ position: { x, y }, size: { w: 40, h: 30 } });
  viewport.store.add(el);
  return el.id;
}

describe('viewport selection emitter', () => {
  let container: HTMLDivElement;
  let viewport: Viewport;
  let select: SelectTool;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    viewport = new Viewport(container);
    select = new SelectTool();
  });

  afterEach(() => {
    viewport.destroy();
    container.remove();
  });

  it('subscribing BEFORE the select tool is registered still delivers events', () => {
    let fired = 0;
    viewport.onSelectionChange(() => fired++);
    viewport.toolManager.register(select); // after subscribe — fails on 0.59.0 (noop)
    const id = seedRect(viewport);
    select.setSelection([id]);
    expect(fired).toBe(1);
    expect(viewport.getSelectedIds()).toEqual([id]);
  });

  it('re-registering an INACTIVE select tool detaches the old instance', () => {
    let fired = 0;
    viewport.onSelectionChange(() => fired++);
    viewport.toolManager.register(select);
    const replacement = new SelectTool();
    viewport.toolManager.register(replacement);
    const id = seedRect(viewport);
    select.setSelection([id]); // old instance: no longer forwarded
    expect(fired).toBe(0);
    replacement.setSelection([id]);
    expect(fired).toBe(1);
  });

  it('ignores non-select tools and select-named tools without the selection API', () => {
    let fired = 0;
    viewport.onSelectionChange(() => fired++);
    viewport.toolManager.register({
      name: 'select',
      onPointerDown() {
        // Intentionally not a real select tool: no selection API.
      },
      onPointerMove() {
        // Intentionally not a real select tool: no selection API.
      },
      onPointerUp() {
        // Intentionally not a real select tool: no selection API.
      },
    });
    // no crash, no attach; still zero events
    expect(fired).toBe(0);
  });

  it('unsubscribe is idempotent and a throwing listener does not break others', () => {
    viewport.toolManager.register(select);
    const calls: string[] = [];
    viewport.onSelectionChange(() => {
      calls.push('a');
      throw new Error('boom');
    });
    const off = viewport.onSelectionChange(() => calls.push('b'));
    const id = seedRect(viewport);
    expect(() => select.setSelection([id])).not.toThrow();
    expect(calls).toEqual(['a', 'b']);
    off();
    off();
    select.setSelection([]);
    expect(calls).toEqual(['a', 'b', 'a']);
  });

  it('destroy detaches forwarder AND registration listener', () => {
    let fired = 0;
    viewport.onSelectionChange(() => fired++);
    viewport.toolManager.register(select);
    const id = seedRect(viewport);
    viewport.destroy();

    // forwarder detached
    select.setSelection([id]);
    expect(fired).toBe(0);

    // registration listener detached: a replacement select tool never attaches
    const replacement = new SelectTool();
    viewport.toolManager.register(replacement);
    replacement.setSelection([id]);
    expect(fired).toBe(0);

    // re-create so afterEach destroy() stays safe
    viewport = new Viewport(container);
  });

  describe('deletion pruning', () => {
    it('deleting a selected element fires once and prunes ids', () => {
      viewport.toolManager.register(select);
      const id = seedRect(viewport);
      select.setSelection([id]);
      let fired = 0;
      viewport.onSelectionChange(() => fired++);
      viewport.store.remove(id); // direct store removal, no transaction
      expect(fired).toBe(1);
      expect(viewport.getSelectedIds()).toEqual([]);
    });

    it('removeElements of multiple selected ids fires exactly ONE event with the final selection', () => {
      viewport.toolManager.register(select);
      const a = seedRect(viewport, 0, 0);
      const b = seedRect(viewport, 100, 0);
      const c = seedRect(viewport, 200, 0);
      select.setSelection([a, b, c]);
      const snapshots: string[][] = [];
      viewport.onSelectionChange(() => snapshots.push([...viewport.getSelectedIds()]));
      viewport.removeElements([a, b]);
      expect(snapshots).toEqual([[c]]); // one event, final state — fails with per-removal pruning
    });

    it('staleness contract: mid-transaction store listener sees pre-prune ids; after removeElements returns, ids are pruned', () => {
      viewport.toolManager.register(select);
      const a = seedRect(viewport, 0, 0);
      const b = seedRect(viewport, 100, 0);
      select.setSelection([a, b]);
      const midTransaction: string[][] = [];
      viewport.store.on('remove', () => midTransaction.push([...viewport.getSelectedIds()]));
      viewport.removeElements([a]);
      expect(midTransaction[0]).toEqual([a, b]); // stale window is contractual
      expect(viewport.getSelectedIds()).toEqual([b]); // pruned synchronously post-commit
    });

    it('keyboard deleteSelected of a multi-selection fires one final event', () => {
      viewport.toolManager.register(select);
      viewport.setTool('select');
      const a = seedRect(viewport, 0, 0);
      const b = seedRect(viewport, 100, 0);
      select.setSelection([a, b]);
      let fired = 0;
      viewport.onSelectionChange(() => fired++);
      viewport.runAction('delete');
      expect(fired).toBe(1);
      expect(viewport.getSelectedIds()).toEqual([]);
    });

    it('deleting an UNSELECTED element fires nothing and preserves the ids array reference', () => {
      viewport.toolManager.register(select);
      const a = seedRect(viewport, 0, 0);
      const other = seedRect(viewport, 100, 0);
      select.setSelection([a]);
      const before = viewport.getSelectedIds();
      let fired = 0;
      viewport.onSelectionChange(() => fired++);
      viewport.store.remove(other);
      expect(fired).toBe(0);
      expect(viewport.getSelectedIds()).toBe(before);
    });

    it('store.clear() empties selection with one event', () => {
      viewport.toolManager.register(select);
      const a = seedRect(viewport);
      select.setSelection([a]);
      let fired = 0;
      viewport.onSelectionChange(() => fired++);
      viewport.store.clear();
      expect(fired).toBe(1);
      expect(viewport.getSelectedIds()).toEqual([]);
    });

    it('destroy detaches pruning and recorder-completion listeners', () => {
      viewport.toolManager.register(select);
      const a = seedRect(viewport, 0, 0);
      const b = seedRect(viewport, 100, 0);
      select.setSelection([a, b]);
      let fired = 0;
      viewport.onSelectionChange(() => fired++);
      viewport.destroy();

      // store pruning listener detached: direct removal of a selected element fires nothing
      viewport.store.remove(a);
      expect(fired).toBe(0);
      expect(select.selectedIds).toEqual([a, b]); // no prune ran

      // recorder-completion listener detached: a transaction-deferred removal flushes nothing
      viewport.transaction(() => {
        viewport.store.remove(b);
      });
      expect(fired).toBe(0);
      expect(select.selectedIds).toEqual([a, b]);

      viewport = new Viewport(container); // afterEach safety
    });

    it('prune adds no history entry: undo restores elements but NOT selection; redo stable', () => {
      viewport.toolManager.register(select);
      const a = seedRect(viewport, 0, 0);
      select.setSelection([a]);
      viewport.removeElements([a]);
      expect(viewport.getSelectedIds()).toEqual([]);
      expect(viewport.undo()).toBe(true);
      expect(viewport.store.getById(a)).toBeDefined();
      expect(viewport.getSelectedIds()).toEqual([]); // selection not restored
      expect(viewport.redo()).toBe(true);
      expect(viewport.store.getById(a)).toBeUndefined();
    });
  });
});
