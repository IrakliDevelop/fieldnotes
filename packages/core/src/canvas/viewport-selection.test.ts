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
});
