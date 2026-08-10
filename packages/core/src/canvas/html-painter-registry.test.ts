import { describe, it, expect, vi } from 'vitest';
import { HtmlPainterRegistry, resolveHtmlRouting } from './html-painter-registry';
import { createHtmlElement } from '../elements/element-factory';

const marker = (htmlType?: string) =>
  createHtmlElement({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, htmlType, layerId: 'l1' });

describe('HtmlPainterRegistry routing', () => {
  it('routes an undeclared, unpainted type to dom', () => {
    const r = new HtmlPainterRegistry();
    expect(resolveHtmlRouting(marker('x'), r)).toBe('dom');
  });

  it('routes a declared type with no painter to missing', () => {
    const r = new HtmlPainterRegistry();
    r.expect(['x']);
    expect(resolveHtmlRouting(marker('x'), r)).toBe('missing');
  });

  it('flips missing -> canvas when the painter registers, and back on unregister', () => {
    const r = new HtmlPainterRegistry();
    r.expect(['x']);
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const off = r.register('x', () => {});
    expect(resolveHtmlRouting(marker('x'), r)).toBe('canvas');
    off();
    expect(resolveHtmlRouting(marker('x'), r)).toBe('missing');
  });

  it('routes to canvas when a painter exists without an explicit declaration', () => {
    const r = new HtmlPainterRegistry();
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    r.register('x', () => {});
    expect(resolveHtmlRouting(marker('x'), r)).toBe('canvas');
  });

  it('unions the caller-supplied expected set with registry declarations', () => {
    const r = new HtmlPainterRegistry();
    expect(resolveHtmlRouting(marker('x'), r, new Set(['x']))).toBe('missing');
  });

  it('routes an element with no htmlType to dom', () => {
    expect(resolveHtmlRouting(marker(undefined), new HtmlPainterRegistry())).toBe('dom');
  });
});

describe('HtmlPainterRegistry identity', () => {
  it('makes the newest registration active and restores the previous on unsubscribe (LIFO)', () => {
    const r = new HtmlPainterRegistry();
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const first = () => {};
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const second = () => {};
    const offFirst = r.register('x', first);
    const offSecond = r.register('x', second);
    expect(r.getActivePainter('x')).toBe(second);
    offSecond();
    expect(r.getActivePainter('x')).toBe(first);
    offFirst();
    expect(r.getActivePainter('x')).toBeUndefined();
    expect(() => offFirst()).not.toThrow();
  });

  it('does not remove the newer painter when an older registration unsubscribes', () => {
    const r = new HtmlPainterRegistry();
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const first = () => {};
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const second = () => {};
    const offFirst = r.register('x', first);
    r.register('x', second);
    offFirst();
    expect(r.getActivePainter('x')).toBe(second);
  });

  it('bumps version only when the ACTIVE registration changes', () => {
    const r = new HtmlPainterRegistry();
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const offFirst = r.register('x', () => {});
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    r.register('x', () => {}); // active changed
    const afterShadowing = r.version;
    offFirst(); // shadowed removal: no active change
    expect(r.version).toBe(afterShadowing);
  });

  it('reference-counts declarations so one release does not undeclare a shared type', () => {
    const r = new HtmlPainterRegistry();
    const releaseA = r.expect(['x']);
    const releaseB = r.expect(['x']);
    releaseA();
    expect(r.canvasTypes.has('x')).toBe(true);
    releaseB();
    expect(r.canvasTypes.has('x')).toBe(false);
    expect(() => releaseB()).not.toThrow();
  });

  it('exposes canvasTypes as declared union actively-painted', () => {
    const r = new HtmlPainterRegistry();
    r.expect(['declared']);
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    r.register('painted', () => {});
    expect([...r.canvasTypes].sort()).toEqual(['declared', 'painted']);
  });

  it('invalidates the memoized canvasTypes on every membership change', () => {
    // canvasTypes is read several times per element per frame, so the Set is memoized.
    // Every transition that can change its membership must drop that cache: reading it
    // BEFORE each transition is what makes a stale cache observable.
    const r = new HtmlPainterRegistry();
    expect([...r.canvasTypes]).toEqual([]);

    const releaseExpect = r.expect(['declared']);
    expect([...r.canvasTypes].sort()).toEqual(['declared']);

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const unregister = r.register('painted', () => {});
    expect([...r.canvasTypes].sort()).toEqual(['declared', 'painted']);

    // Stacked painter for the same type: membership is unchanged, and so is the answer.
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const unregisterTop = r.register('painted', () => {});
    expect([...r.canvasTypes].sort()).toEqual(['declared', 'painted']);
    unregisterTop();
    expect([...r.canvasTypes].sort()).toEqual(['declared', 'painted']);

    releaseExpect();
    expect([...r.canvasTypes].sort()).toEqual(['painted']);

    unregister();
    expect([...r.canvasTypes]).toEqual([]);

    // A second identical read is still correct (and is the cached instance).
    expect(r.canvasTypes).toBe(r.canvasTypes);
  });

  it('notifies onChange once per active change and stops after unsubscribe', () => {
    const r = new HtmlPainterRegistry();
    const listener = vi.fn();
    const off = r.onChange(listener);
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    r.register('x', () => {});
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    r.register('y', () => {});
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing onChange listener from siblings', () => {
    const r = new HtmlPainterRegistry();
    const good = vi.fn();
    r.onChange(() => {
      throw new Error('boom');
    });
    r.onChange(good);
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    expect(() => r.register('x', () => {})).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});
