import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderFogStylePreview } from './fog-style-preview';

const sourceContext = {
  fillRect: vi.fn(),
  fillStyle: '',
  globalCompositeOperation: 'source-over',
  putImageData: vi.fn(),
};
const sourceCanvas = {
  width: 0,
  height: 0,
  getContext: vi.fn<() => typeof sourceContext | null>(() => sourceContext),
};

beforeEach(() => {
  vi.clearAllMocks();
  sourceContext.fillStyle = '';
  sourceContext.globalCompositeOperation = 'source-over';
  vi.stubGlobal(
    'ImageData',
    class ImageData {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    },
  );
  vi.spyOn(document, 'createElement').mockReturnValue(sourceCanvas as unknown as HTMLCanvasElement);
});

function context() {
  return {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: '',
    restore: vi.fn(),
    save: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe('renderFogStylePreview', () => {
  it.each([
    [0, 80],
    [80, -1],
    [Number.POSITIVE_INFINITY, 80],
    [80, Number.NaN],
  ])('ignores an invalid %s by %s preview size', (width, height) => {
    const ctx = context();
    renderFogStylePreview(ctx, { kind: 'solid', color: '#123456' }, width, height);

    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('fills a solid preview without allocating a procedural tile', () => {
    const ctx = context();
    renderFogStylePreview(ctx, { kind: 'solid', color: '#123456' }, 80, 60);

    expect(ctx.fillStyle).toBe('#123456');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 80, 60);
    expect(document.createElement).not.toHaveBeenCalled();
  });

  it('composites the exact procedural mask tint over the backdrop at material scale', () => {
    const ctx = context();
    renderFogStylePreview(
      ctx,
      {
        kind: 'procedural',
        backdrop: '#102030',
        tint: '#a0b0c0',
        opacity: 0.4,
        scale: 64,
        detail: 3,
        seed: 7,
      },
      100,
      80,
    );

    expect(ctx.fillStyle).toBe('#102030');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 80);
    expect(sourceContext.putImageData).toHaveBeenCalledOnce();
    expect(sourceContext.globalCompositeOperation).toBe('source-in');
    expect(sourceContext.fillStyle).toBe('#a0b0c0');
    expect(ctx.drawImage).toHaveBeenCalledTimes(4);
    expect(ctx.drawImage).toHaveBeenCalledWith(sourceCanvas, 64, 64, 64, 64);
  });

  it('keeps the backdrop when the browser cannot allocate a source context', () => {
    sourceCanvas.getContext.mockReturnValueOnce(null);
    const ctx = context();
    renderFogStylePreview(
      ctx,
      { kind: 'procedural', backdrop: '#102030', tint: '#ffffff' },
      80,
      80,
    );

    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 80, 80);
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalledOnce();
  });
});
