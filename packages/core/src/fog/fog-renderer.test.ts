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
});
