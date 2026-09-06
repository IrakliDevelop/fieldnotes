import type { FogStyle } from './fog-style';
import { resolveFogStyle } from './fog-style';
import { getCachedProceduralTile } from './fog-procedural-tile';

const DEFAULT_PREVIEW_COLOR = '#0b1020';

/**
 * Paints a fog material swatch using the same deterministic procedural tile
 * and world-space scale as the viewport renderer. One canvas pixel represents
 * one world unit, so callers can size the swatch without changing the material.
 * Procedural allocation failures degrade to the backdrop color.
 */
export function renderFogStylePreview(
  ctx: CanvasRenderingContext2D,
  style: FogStyle,
  width: number,
  height: number,
): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
  const w = width;
  const h = height;

  const resolved = resolveFogStyle(style, undefined, DEFAULT_PREVIEW_COLOR);
  ctx.save();
  try {
    ctx.fillStyle = resolved.kind === 'solid' ? resolved.color : resolved.backdrop;
    ctx.fillRect(0, 0, w, h);
    if (resolved.kind === 'solid' || typeof document === 'undefined') return;

    try {
      const tile = getCachedProceduralTile(resolved);
      const source = document.createElement('canvas');
      source.width = tile.width;
      source.height = tile.height;
      const sourceCtx = source.getContext('2d');
      if (!sourceCtx) return;

      sourceCtx.putImageData(
        new ImageData(new Uint8ClampedArray(tile.data), tile.width, tile.height),
        0,
        0,
      );
      sourceCtx.globalCompositeOperation = 'source-in';
      sourceCtx.fillStyle = resolved.tint;
      sourceCtx.fillRect(0, 0, tile.width, tile.height);

      for (let y = 0; y < h; y += resolved.scale) {
        for (let x = 0; x < w; x += resolved.scale) {
          ctx.drawImage(source, x, y, resolved.scale, resolved.scale);
        }
      }
    } catch {
      // The backdrop is already painted. Preview allocation and canvas failures
      // must degrade to a useful solid swatch instead of failing the host UI.
    }
  } finally {
    ctx.restore();
  }
}
