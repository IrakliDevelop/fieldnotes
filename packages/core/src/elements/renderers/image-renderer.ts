import type { ImageElement } from '../types';

export function renderImage(
  ctx: CanvasRenderingContext2D,
  image: ImageElement,
  imageCache: Map<string, ImageBitmap | HTMLImageElement | 'failed'>,
  onImageLoad: (() => void) | null,
  onImageError: ((src: string, cause?: unknown) => void) | null,
): void {
  if (imageCache.get(image.src) === 'failed') {
    renderImagePlaceholder(ctx, image);
    return;
  }
  const img = getImage(image.src, imageCache, onImageLoad, onImageError);
  if (!img) return;
  ctx.drawImage(
    img as CanvasImageSource,
    image.position.x,
    image.position.y,
    image.size.w,
    image.size.h,
  );
}

function renderImagePlaceholder(ctx: CanvasRenderingContext2D, image: ImageElement): void {
  const { x, y } = image.position;
  const { w, h } = image.size;
  ctx.save();
  ctx.fillStyle = '#eeeeee';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#bdbdbd';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);

  const glyph = Math.min(24, w / 2, h / 2);
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.strokeStyle = '#9e9e9e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, glyph / 2, 0, Math.PI * 2);
  ctx.moveTo(cx - glyph / 2, cy + glyph / 2);
  ctx.lineTo(cx + glyph / 2, cy - glyph / 2);
  ctx.stroke();
  ctx.restore();
}

function getImage(
  src: string,
  imageCache: Map<string, ImageBitmap | HTMLImageElement | 'failed'>,
  onImageLoad: (() => void) | null,
  onImageError: ((src: string, cause?: unknown) => void) | null,
): ImageBitmap | HTMLImageElement | null {
  const cached = imageCache.get(src);
  if (cached) {
    if (cached === 'failed') return null;
    if (cached instanceof HTMLImageElement) return cached.complete ? cached : null;
    return cached;
  }

  const img = new Image();
  img.src = src;
  imageCache.set(src, img);
  img.onload = () => {
    onImageLoad?.();
    // Decode from already-loaded image in memory, not a re-fetch
    if (typeof createImageBitmap !== 'undefined') {
      createImageBitmap(img)
        .then((bitmap) => {
          imageCache.set(src, bitmap);
          onImageLoad?.();
        })
        .catch(() => {
          /* keep HTMLImageElement fallback — handles CORS rejection */
        });
    }
  };
  img.onerror = (event) => {
    // failed srcs stay failed for the session; pointing the element at a new src loads fresh
    imageCache.set(src, 'failed');
    onImageError?.(src, event);
    onImageLoad?.();
  };
  return null;
}
