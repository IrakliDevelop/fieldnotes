// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Camera } from '../canvas/camera';
import { FogRenderer } from './fog-renderer';
import { createTileBytes, encodeBase64 } from './tile-codec';

function context(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillStyle: '',
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FogRenderer tile raster cache', () => {
  it('rasterizes a tile once and reuses the bitmap across camera redraws', () => {
    const rasterContext = context();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(rasterContext);
    const target = context();
    const renderer = new FogRenderer();
    renderer.setState({
      definition: {
        version: 1,
        generation: 'gen-1',
        bounds: { x: 0, y: 0, w: 128, h: 128 },
        cellSize: 1,
        tileCells: 128,
        base: 'revealed',
      },
      tiles: [{ x: 0, y: 0, data: encodeBase64(createTileBytes(false)) }],
    });
    renderer.setViewMode('player');
    const camera = {
      position: { x: 0, y: 0 },
      zoom: 1,
      screenToWorld: ({ x, y }: { x: number; y: number }) => ({ x, y }),
    } as Camera;

    renderer.render(target, camera, 128, 128, 1);
    const rasterFillCount = vi.mocked(rasterContext.fillRect).mock.calls.length;
    renderer.markDirty();
    renderer.render(target, camera, 128, 128, 1);

    expect(rasterFillCount).toBe(128 * 128);
    expect(rasterContext.fillRect).toHaveBeenCalledTimes(rasterFillCount);
    expect(target.drawImage).toHaveBeenCalledTimes(2);
  });

  it('paints an opaque safety base before an alpha-bearing procedural player backdrop', () => {
    const fills: { style: unknown; x: number; y: number; w: number; h: number }[] = [];
    let targetFillStyle: unknown = '';
    const pattern = { setTransform: vi.fn() } as unknown as CanvasPattern;
    const target = {
      save: vi.fn(),
      restore: vi.fn(),
      createPattern: vi.fn(() => pattern),
      fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
        fills.push({ style: targetFillStyle, x, y, w, h });
      }),
      get fillStyle() {
        return targetFillStyle;
      },
      set fillStyle(value: unknown) {
        targetFillStyle = value;
      },
    } as unknown as CanvasRenderingContext2D;
    const source = {
      putImageData: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillStyle: '',
      globalCompositeOperation: 'source-over',
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(source);
    vi.stubGlobal(
      'ImageData',
      class {
        constructor(
          readonly data: Uint8ClampedArray,
          readonly width: number,
          readonly height: number,
        ) {}
      },
    );
    vi.stubGlobal(
      'DOMMatrix',
      class {
        constructor(readonly values?: number[]) {}
      },
    );

    const renderer = new FogRenderer({
      playerStyle: {
        kind: 'procedural',
        backdrop: 'rgba(11, 16, 32, 0.4)',
        tint: 'rebeccapurple',
      },
    });
    renderer.renderForExport(
      target,
      {
        definition: {
          version: 1,
          generation: 'gen-1',
          bounds: { x: 0, y: 0, w: 16, h: 16 },
          cellSize: 1,
          tileCells: 128,
          base: 'covered',
        },
        tiles: [],
      },
      'player',
    );

    expect(fills).toEqual([
      { style: '#0b1020', x: 0, y: 0, w: 16, h: 16 },
      { style: 'rgba(11, 16, 32, 0.4)', x: 0, y: 0, w: 16, h: 16 },
      { style: pattern, x: 0, y: 0, w: 16, h: 16 },
    ]);
    expect(source.fillStyle).toBe('rebeccapurple');
    expect(pattern.setTransform).toHaveBeenCalledTimes(1);
  });

  it('falls back to backdrop-only fog when procedural pattern creation throws', () => {
    let fillStyle: unknown = '';
    const fills: unknown[] = [];
    const target = {
      save: vi.fn(),
      restore: vi.fn(),
      createPattern: vi.fn(() => {
        throw new Error('pattern unavailable');
      }),
      fillRect: vi.fn(() => fills.push(fillStyle)),
      get fillStyle() {
        return fillStyle;
      },
      set fillStyle(value: unknown) {
        fillStyle = value;
      },
    } as unknown as CanvasRenderingContext2D;
    const source = {
      putImageData: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
      globalCompositeOperation: 'source-over',
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(source);
    vi.stubGlobal(
      'ImageData',
      class {
        constructor(
          readonly data: Uint8ClampedArray,
          readonly width: number,
          readonly height: number,
        ) {}
      },
    );

    const renderer = new FogRenderer({
      editorStyle: { kind: 'procedural', backdrop: '#20283a', tint: '#8090b0' },
    });
    expect(() =>
      renderer.renderForExport(
        target,
        {
          definition: {
            version: 1,
            generation: 'gen-1',
            bounds: { x: 0, y: 0, w: 8, h: 8 },
            cellSize: 1,
            tileCells: 128,
            base: 'covered',
          },
          tiles: [],
        },
        'editor',
      ),
    ).not.toThrow();
    expect(fills).toEqual(['#20283a']);
  });
});
