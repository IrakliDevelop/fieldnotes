import type { Bounds } from '../core/types';

/**
 * Owns the cache anchor (the camera state the screen-space caches were last rendered at)
 * and the margin geometry. Pure — holds no canvas. Caches render a region inflated by
 * `marginPx` on every side, so a pan within the margin is an offset-blit, not a re-raster.
 *
 * Call setViewport(cssW, cssH, dpr) before physicalWidth/Height, applyRenderTransform, or compositeOffset — they read the stored dpr.
 */
export class MarginViewport {
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private anchorCamX = 0;
  private anchorCamY = 0;
  private anchorZoom = Number.NaN; // sentinel → first needsRecenter is true
  private viewportDirty = true;

  constructor(private marginPx: number) {}

  setMargin(marginPx: number): void {
    if (marginPx !== this.marginPx) {
      this.marginPx = marginPx;
      this.viewportDirty = true;
    }
  }

  setViewport(cssW: number, cssH: number, dpr: number): void {
    if (cssW !== this.cssW || cssH !== this.cssH || dpr !== this.dpr) {
      this.cssW = cssW;
      this.cssH = cssH;
      this.dpr = dpr;
      this.viewportDirty = true;
    }
  }

  physicalWidth(): number {
    return Math.round((this.cssW + 2 * this.marginPx) * this.dpr);
  }

  physicalHeight(): number {
    return Math.round((this.cssH + 2 * this.marginPx) * this.dpr);
  }

  needsRecenter(camX: number, camY: number, zoom: number): boolean {
    return (
      this.viewportDirty ||
      zoom !== this.anchorZoom ||
      Math.abs(camX - this.anchorCamX) > this.marginPx ||
      Math.abs(camY - this.anchorCamY) > this.marginPx
    );
  }

  recenter(camX: number, camY: number, zoom: number): void {
    this.anchorCamX = camX;
    this.anchorCamY = camY;
    this.anchorZoom = zoom;
    this.viewportDirty = false;
  }

  /** Applies dpr scale + anchor-relative world transform. setViewport must have been called first. */
  applyRenderTransform(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D): void {
    ctx.scale(this.dpr, this.dpr);
    ctx.translate(this.marginPx + this.anchorCamX, this.marginPx + this.anchorCamY);
    ctx.scale(this.anchorZoom, this.anchorZoom);
  }

  // Device-px destination for drawImage(cache, x, y).
  // A world point P sits in the cache at CSS x `margin + anchorCamX + P*zoom`; it must land on
  // screen at `camX + P*zoom`; so the blit offset is `camX - anchorCamX - margin` (CSS) * dpr.
  compositeOffset(camX: number, camY: number): { x: number; y: number } {
    return {
      x: (camX - this.anchorCamX - this.marginPx) * this.dpr,
      y: (camY - this.anchorCamY - this.marginPx) * this.dpr,
    };
  }

  // World-space bounds of the whole cached region at the anchor (cull rect for re-renders).
  cachedWorldBounds(): Bounds {
    const z = this.anchorZoom;
    return {
      x: (-this.marginPx - this.anchorCamX) / z,
      y: (-this.marginPx - this.anchorCamY) / z,
      w: (this.cssW + 2 * this.marginPx) / z,
      h: (this.cssH + 2 * this.marginPx) / z,
    };
  }
}
