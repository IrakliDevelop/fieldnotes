import { describe, it, expect, vi } from 'vitest';
import { paintHtmlElement } from './html-paint';
import { HtmlPaintDiagnosticDeduper } from './html-paint-diagnostics';
import { createHtmlElement } from '../elements/element-factory';

function fakeCtx() {
  const calls: string[] = [];
  return {
    calls,
    save: () => void calls.push('save'),
    restore: () => void calls.push('restore'),
    translate: (x: number, y: number) => void calls.push(`translate:${x},${y}`),
    rotate: (a: number) => void calls.push(`rotate:${a}`),
    beginPath: () => void calls.push('beginPath'),
    rect: (x: number, y: number, w: number, h: number) =>
      void calls.push(`rect:${x},${y},${w},${h}`),
    clip: () => void calls.push('clip'),
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D & { calls: string[] };
}

const el = (over: Partial<Parameters<typeof createHtmlElement>[0]> = {}) =>
  createHtmlElement({
    position: { x: 20, y: 30 },
    size: { w: 40, h: 40 },
    htmlType: 'rk-marker',
    layerId: 'l1',
    ...over,
  });

describe('paintHtmlElement', () => {
  it('translates to the element origin, clips to its rect, and restores', () => {
    const ctx = fakeCtx();
    paintHtmlElement(
      el(),
      () => {
        // noop painter
      },
      { ctx, zoom: 1, target: 'screen' },
    );
    expect(ctx.calls).toContain('translate:20,30');
    expect(ctx.calls).toContain('rect:0,0,40,40');
    expect(ctx.calls).toContain('clip');
    expect(ctx.calls[0]).toBe('save');
    expect(ctx.calls.at(-1)).toBe('restore');
  });

  it('applies NO alpha of its own', () => {
    const ctx = fakeCtx();
    ctx.globalAlpha = 0.5;
    paintHtmlElement(
      el(),
      () => {
        // noop painter
      },
      { ctx, zoom: 1, target: 'screen' },
    );
    expect(ctx.globalAlpha).toBe(0.5);
  });

  it('passes local size and surface zoom to the painter', () => {
    const painter = vi.fn();
    paintHtmlElement(el(), painter, { ctx: fakeCtx(), zoom: 2.5, target: 'minimap' });
    expect(painter).toHaveBeenCalledTimes(1);
    const arg = painter.mock.calls[0]?.[0];
    expect(arg.size).toEqual({ w: 40, h: 40 });
    expect(arg.zoom).toBe(2.5);
  });

  it('restores context state and reports painter-threw when the painter throws', () => {
    const ctx = fakeCtx();
    const onDiagnostic = vi.fn();
    expect(() =>
      paintHtmlElement(
        el(),
        () => {
          throw new Error('boom');
        },
        { ctx, zoom: 1, target: 'screen', onDiagnostic },
      ),
    ).not.toThrow();
    expect(ctx.calls.at(-1)).toBe('restore');
    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'painter-threw', target: 'screen' }),
    );
  });

  it.each([
    ['zero width', { w: 0, h: 10 }],
    ['negative width', { w: -10, h: 10 }],
    ['zero height', { w: 10, h: 0 }],
    ['negative height', { w: 10, h: -10 }],
  ])('skips the painter for %s and reports degenerate-size', (_label, size) => {
    const painter = vi.fn();
    const onDiagnostic = vi.fn();
    paintHtmlElement(el({ size }), painter, {
      ctx: fakeCtx(),
      zoom: 1,
      target: 'export',
      onDiagnostic,
    });
    expect(painter).not.toHaveBeenCalled();
    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'degenerate-size', target: 'export' }),
    );
  });

  it('rotates about the element centre when rotation is set', () => {
    const ctx = fakeCtx();
    paintHtmlElement(
      el({ rotation: 0.5 }),
      () => {
        // noop painter
      },
      { ctx, zoom: 1, target: 'screen' },
    );
    // Pin the ordered centre-rotation sequence: translate to centre, rotate,
    // translate back by -halfSize. Order matters — a top-left rotation would
    // also emit `rotate:0.5` but with the wrong translate calls/order.
    const transformCalls = ctx.calls.filter(
      (c) => c.startsWith('translate:') || c.startsWith('rotate:'),
    );
    expect(transformCalls).toEqual(['translate:40,50', 'rotate:0.5', 'translate:-20,-20']);
  });

  it('skips rotation when applyRotation is false, for callers that rotate themselves', () => {
    // SVG export wraps the raster in withRotationSvg; rotating here too would double-apply.
    const ctx = fakeCtx();
    paintHtmlElement(
      el({ rotation: 0.5 }),
      () => {
        // noop painter
      },
      {
        ctx,
        zoom: 1,
        target: 'export',
        applyRotation: false,
      },
    );
    expect(ctx.calls.some((c) => c.startsWith('rotate:'))).toBe(false);
    expect(ctx.calls).toContain('translate:20,30'); // position translation still applies
  });
});

describe('HtmlPaintDiagnosticDeduper', () => {
  const diag = {
    kind: 'degenerate-size' as const,
    elementId: 'e1',
    htmlType: 'rk-marker',
    target: 'screen' as const,
  };

  it('emits once for repeated identical frames', () => {
    const sink = vi.fn();
    const d = new HtmlPaintDiagnosticDeduper(sink);
    d.emit(diag, { registryVersion: 1, elementVersion: 1 });
    d.emit(diag, { registryVersion: 1, elementVersion: 1 });
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('re-emits after a registry version bump', () => {
    const sink = vi.fn();
    const d = new HtmlPaintDiagnosticDeduper(sink);
    d.emit(diag, { registryVersion: 1, elementVersion: 1 });
    d.emit(diag, { registryVersion: 2, elementVersion: 1 });
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('reports a fail -> repair -> fail-again sequence twice', () => {
    const sink = vi.fn();
    const d = new HtmlPaintDiagnosticDeduper(sink);
    d.emit(diag, { registryVersion: 1, elementVersion: 1 }); // bad
    // element repaired at version 2 — no diagnostic emitted at all
    d.emit(diag, { registryVersion: 1, elementVersion: 3 }); // regressed
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('forgets an element so a re-added id starts clean', () => {
    const sink = vi.fn();
    const d = new HtmlPaintDiagnosticDeduper(sink);
    d.emit(diag, { registryVersion: 1, elementVersion: 1 });
    d.forget('e1');
    d.emit(diag, { registryVersion: 1, elementVersion: 1 });
    expect(sink).toHaveBeenCalledTimes(2);
  });
});
