// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImage } from '../element-factory';
import { renderImage } from './image-renderer';

function mockCtx(): CanvasRenderingContext2D {
  return {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D;
}

function imageElement() {
  return createImage({
    position: { x: 10, y: 20 },
    size: { w: 30, h: 40 },
    src: 'https://images.example/photo.png',
  });
}

describe('renderImage', () => {
  const images: HTMLImageElement[] = [];

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- replaces the browser constructor
    class FakeImage {
      constructor() {
        const image = document.createElement('img');
        Object.defineProperty(image, 'complete', { value: false, writable: true });
        images.push(image);
        return image;
      }
    }
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('createImageBitmap', undefined);
  });

  afterEach(() => {
    images.length = 0;
    vi.unstubAllGlobals();
  });

  function start(
    cache = new Map<string, ImageBitmap | HTMLImageElement | 'failed'>(),
    onImageLoad: ((src: string) => void) | null = null,
    onImageError: ((src: string, cause?: unknown) => void) | null = null,
  ) {
    const ctx = mockCtx();
    const image = imageElement();
    renderImage(ctx, image, cache, onImageLoad, onImageError);
    return { cache, ctx, image };
  }

  function retry(first: HTMLImageElement): HTMLImageElement {
    first.dispatchEvent(new Event('error'));
    const result = images[images.length - 1];
    if (!result) throw new Error('expected retry image');
    return result;
  }

  it('first load is anonymous CORS', () => {
    const { image } = start();

    expect(images).toHaveLength(1);
    expect(images[0]?.crossOrigin).toBe('anonymous');
    expect(images[0]?.src).toBe(image.src);
  });

  it('retries once without crossOrigin after a CORS error', () => {
    const onImageError = vi.fn();
    const { cache, image } = start(undefined, null, onImageError);
    const first = images[0];
    if (!first) throw new Error('expected first image');

    const second = retry(first);

    expect(images).toHaveLength(2);
    expect(second.src).toBe(image.src);
    expect(second.crossOrigin).toBeNull();
    expect(second.getAttribute('crossorigin')).toBeNull();
    expect(cache.get(image.src)).toBe(second);
    expect(onImageError).not.toHaveBeenCalled();
  });

  it('marks failed after the retry fails', () => {
    const onImageLoad = vi.fn();
    const onImageError = vi.fn();
    const { cache, ctx, image } = start(undefined, onImageLoad, onImageError);
    const first = images[0];
    if (!first) throw new Error('expected first image');
    const second = retry(first);
    const cause = new Event('error');

    second.dispatchEvent(cause);

    expect(cache.get(image.src)).toBe('failed');
    expect(onImageError).toHaveBeenCalledWith(image.src, cause);
    expect(onImageLoad).toHaveBeenCalledWith(image.src);
    renderImage(ctx, image, cache, onImageLoad, onImageError);
    expect(ctx.fillRect).toHaveBeenCalledWith(10, 20, 30, 40);
    expect(ctx.fillStyle).toBe('#eeeeee');
  });

  it('draws after the retry loads', () => {
    const { cache, ctx, image } = start();
    const first = images[0];
    if (!first) throw new Error('expected first image');
    const second = retry(first);
    Object.defineProperty(second, 'complete', { value: true, writable: true });
    second.dispatchEvent(new Event('load'));

    renderImage(ctx, image, cache, null, null);

    expect(ctx.drawImage).toHaveBeenCalledWith(second, 10, 20, 30, 40);
  });

  it('replaces the retry image with its bitmap and closes a stale bitmap', async () => {
    const resolvers: ((bitmap: unknown) => void)[] = [];
    const bitmap = { close: vi.fn() };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => new Promise((resolve) => resolvers.push(resolve))),
    );
    const { cache, image } = start();
    const first = images[0];
    if (!first) throw new Error('expected first image');
    const second = retry(first);
    second.dispatchEvent(new Event('load'));
    const resolveBitmap = resolvers[0];
    if (!resolveBitmap) throw new Error('expected bitmap request');
    resolveBitmap(bitmap);
    await Promise.resolve();

    expect(cache.get(image.src)).toBe(bitmap);

    const stale = start();
    const staleFirst = images[2];
    if (!staleFirst) throw new Error('expected first stale image');
    const staleSecond = retry(staleFirst);
    staleSecond.dispatchEvent(new Event('load'));
    stale.cache.clear();
    const staleBitmap = { close: vi.fn() };
    const resolveStaleBitmap = resolvers[1];
    if (!resolveStaleBitmap) throw new Error('expected stale bitmap request');
    resolveStaleBitmap(staleBitmap);
    await Promise.resolve();

    expect(stale.cache.size).toBe(0);
    expect(staleBitmap.close).toHaveBeenCalledTimes(1);
  });
});
