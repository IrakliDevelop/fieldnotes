import { describe, it, expect, vi } from 'vitest';
import { FogTool } from './fog-tool';
import { FogManager } from '../fog/fog-manager';
import { ElementStore } from '../elements/element-store';
import type { ToolContext, PointerState } from './types';
import type { FogRegion } from '../fog/types';
import { Camera } from '../canvas/camera';

function makeToolContext(): ToolContext {
  return {
    camera: new Camera(),
    store: new ElementStore(),
    requestRender: vi.fn(),
    setCursor: vi.fn(),
  };
}

function makePointerState(x: number, y: number): PointerState {
  return { x, y, pressure: 0.5, pointerType: 'mouse', shiftKey: false };
}

function makeManager() {
  let genId = 0;
  return new FogManager({
    idFactory: () => `test-gen-${++genId}`,
  });
}

function firstCallArg(spy: ReturnType<typeof vi.spyOn>): FogRegion {
  return (spy.mock.calls[0] as [FogRegion])[0];
}

describe('FogTool', () => {
  it('has name fog', () => {
    const m = makeManager();
    const tool = new FogTool(m);
    expect(tool.name).toBe('fog');
  });

  it('pointer down/up with brush calls manager once', () => {
    const m = makeManager();
    m.initialize({ bounds: { x: 0, y: 0, w: 1024, h: 1024 }, cellSize: 1 });
    const spy = vi.spyOn(m, 'applyRegion');
    const tool = new FogTool(m, { shape: 'brush', operation: 'reveal' });
    const ctx = makeToolContext();

    tool.onPointerDown(makePointerState(50, 50), ctx);
    tool.onPointerMove(makePointerState(60, 60), ctx);
    tool.onPointerMove(makePointerState(70, 70), ctx);
    tool.onPointerUp(makePointerState(70, 70), ctx);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(firstCallArg(spy).kind).toBe('brush');
  });

  it('pointer cancel discards gesture without mutation', () => {
    const m = makeManager();
    m.initialize({ bounds: { x: 0, y: 0, w: 1024, h: 1024 }, cellSize: 1 });
    const spy = vi.spyOn(m, 'applyRegion');
    const tool = new FogTool(m, { shape: 'brush' });
    const ctx = makeToolContext();

    tool.onPointerDown(makePointerState(50, 50), ctx);
    tool.onPointerMove(makePointerState(60, 60), ctx);
    expect(tool.onPointerCancel).toBeDefined();
    (tool.onPointerCancel as NonNullable<typeof tool.onPointerCancel>)(
      makePointerState(60, 60),
      ctx,
    );

    expect(spy).not.toHaveBeenCalled();
  });

  it('Escape cancels gesture', () => {
    const m = makeManager();
    m.initialize({ bounds: { x: 0, y: 0, w: 1024, h: 1024 }, cellSize: 1 });
    const spy = vi.spyOn(m, 'applyRegion');
    const tool = new FogTool(m, { shape: 'brush' });
    const ctx = makeToolContext();

    tool.onPointerDown(makePointerState(50, 50), ctx);
    expect(tool.onKeyDown).toBeDefined();
    const consumed = (tool.onKeyDown as NonNullable<typeof tool.onKeyDown>)(
      { key: 'Escape' } as KeyboardEvent,
      ctx,
    );
    expect(consumed).toBe(true);

    tool.onPointerUp(makePointerState(50, 50), ctx);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rectangle mode uses from/to', () => {
    const m = makeManager();
    m.initialize({ bounds: { x: 0, y: 0, w: 1024, h: 1024 }, cellSize: 1 });
    const spy = vi.spyOn(m, 'applyRegion');
    const tool = new FogTool(m, { shape: 'rectangle', operation: 'reveal' });
    const ctx = makeToolContext();

    tool.onPointerDown(makePointerState(10, 10), ctx);
    tool.onPointerMove(makePointerState(100, 100), ctx);
    tool.onPointerUp(makePointerState(100, 100), ctx);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(firstCallArg(spy).kind).toBe('rectangle');
  });

  it('polygon mode uses accumulated points', () => {
    const m = makeManager();
    m.initialize({ bounds: { x: 0, y: 0, w: 1024, h: 1024 }, cellSize: 1 });
    const spy = vi.spyOn(m, 'applyRegion');
    const tool = new FogTool(m, { shape: 'polygon', operation: 'reveal' });
    const ctx = makeToolContext();

    tool.onPointerDown(makePointerState(10, 10), ctx);
    tool.onPointerMove(makePointerState(100, 10), ctx);
    tool.onPointerMove(makePointerState(100, 100), ctx);
    tool.onPointerMove(makePointerState(10, 100), ctx);
    tool.onPointerUp(makePointerState(10, 100), ctx);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(firstCallArg(spy).kind).toBe('polygon');
  });

  it('zero-area click does not mutate', () => {
    const m = makeManager();
    m.initialize({ bounds: { x: 0, y: 0, w: 1024, h: 1024 }, cellSize: 1 });
    const spy = vi.spyOn(m, 'applyRegion');
    const tool = new FogTool(m, { shape: 'rectangle' });
    const ctx = makeToolContext();

    tool.onPointerDown(makePointerState(50, 50), ctx);
    tool.onPointerUp(makePointerState(50, 50), ctx);
    expect(spy).not.toHaveBeenCalled();
  });

  it('setOptions updates options without rebuilding', () => {
    const m = makeManager();
    const tool = new FogTool(m);
    expect(tool.getOptions().operation).toBe('reveal');
    tool.setOptions({ operation: 'conceal', radius: 80 });
    expect(tool.getOptions().operation).toBe('conceal');
    expect(tool.getOptions().radius).toBe(80);
  });

  it('setOptions notifies listeners', () => {
    const m = makeManager();
    const tool = new FogTool(m);
    const spy = vi.fn();
    expect(tool.onOptionsChange).toBeDefined();
    (tool.onOptionsChange as NonNullable<typeof tool.onOptionsChange>)(spy);
    tool.setOptions({ operation: 'conceal' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('ignores non-finite radius in setOptions', () => {
    const m = makeManager();
    const tool = new FogTool(m, { radius: 40 });
    tool.setOptions({ radius: NaN });
    expect(tool.getOptions().radius).toBe(40);
    tool.setOptions({ radius: -5 });
    expect(tool.getOptions().radius).toBe(40);
  });

  it('tool switch via deactivate cancels gesture', () => {
    const m = makeManager();
    m.initialize({ bounds: { x: 0, y: 0, w: 1024, h: 1024 }, cellSize: 1 });
    const spy = vi.spyOn(m, 'applyRegion');
    const tool = new FogTool(m, { shape: 'brush' });
    const ctx = makeToolContext();

    tool.onPointerDown(makePointerState(50, 50), ctx);
    tool.onPointerMove(makePointerState(60, 60), ctx);
    expect(tool.onDeactivate).toBeDefined();
    (tool.onDeactivate as NonNullable<typeof tool.onDeactivate>)(ctx);

    expect(spy).not.toHaveBeenCalled();
  });

  it('multi-pointer rejection: second down ignored while drawing', () => {
    const m = makeManager();
    m.initialize({ bounds: { x: 0, y: 0, w: 1024, h: 1024 }, cellSize: 1 });
    const spy = vi.spyOn(m, 'applyRegion');
    const tool = new FogTool(m, { shape: 'brush' });
    const ctx = makeToolContext();

    tool.onPointerDown(makePointerState(50, 50), ctx);
    tool.onPointerDown(makePointerState(200, 200), ctx);
    tool.onPointerMove(makePointerState(60, 60), ctx);
    tool.onPointerUp(makePointerState(60, 60), ctx);

    expect(spy).toHaveBeenCalledTimes(1);
    const region = firstCallArg(spy);
    if (region.kind === 'brush') {
      const maxX = Math.max(...region.points.map((p) => p.x));
      expect(maxX).toBeLessThan(100);
    }
  });
});
