import type { Camera } from './camera';

export type BackgroundPattern = 'dots' | 'grid' | 'none';

export interface BackgroundOptions {
  pattern?: BackgroundPattern;
  spacing?: number;
  color?: string;
  dotRadius?: number;
  lineWidth?: number;
}

const MIN_PATTERN_SPACING = 16;

const DEFAULTS = {
  pattern: 'dots' as BackgroundPattern,
  spacing: 24,
  color: '#d0d0d0',
  dotRadius: 1,
  lineWidth: 0.5,
};

export class Background {
  private readonly pattern: BackgroundPattern;
  private readonly spacing: number;
  private readonly color: string;
  private readonly dotRadius: number;
  private readonly lineWidth: number;
  private cachedCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private cachedCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  private lastZoom = -1;
  private lastOffsetX = -Infinity;
  private lastOffsetY = -Infinity;
  private lastWidth = 0;
  private lastHeight = 0;

  constructor(options: BackgroundOptions = {}) {
    this.pattern = options.pattern ?? DEFAULTS.pattern;
    this.spacing = options.spacing ?? DEFAULTS.spacing;
    this.color = options.color ?? DEFAULTS.color;
    this.dotRadius = options.dotRadius ?? DEFAULTS.dotRadius;
    this.lineWidth = options.lineWidth ?? DEFAULTS.lineWidth;
  }

  render(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const { width, height } = ctx.canvas;
    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
    const cssWidth = width / dpr;
    const cssHeight = height / dpr;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    if (this.pattern === 'none') {
      ctx.restore();
      return;
    }

    const spacing = this.adaptSpacing(this.spacing, camera.zoom);
    const keyZoom = camera.zoom;
    const keyX = Math.floor(camera.position.x % spacing);
    const keyY = Math.floor(camera.position.y % spacing);

    if (
      this.cachedCanvas !== null &&
      keyZoom === this.lastZoom &&
      keyX === this.lastOffsetX &&
      keyY === this.lastOffsetY &&
      cssWidth === this.lastWidth &&
      cssHeight === this.lastHeight
    ) {
      ctx.drawImage(this.cachedCanvas as CanvasImageSource, 0, 0);
      ctx.restore();
      return;
    }

    this.ensureCachedCanvas(cssWidth, cssHeight, dpr);

    if (this.cachedCtx === null) {
      // Fallback: render directly when offscreen canvas is unavailable (e.g. jsdom)
      if (this.pattern === 'dots') {
        this.renderDots(ctx, camera, cssWidth, cssHeight);
      } else if (this.pattern === 'grid') {
        this.renderGrid(ctx, camera, cssWidth, cssHeight);
      }
      ctx.restore();
      return;
    }

    const offCtx = this.cachedCtx as CanvasRenderingContext2D;
    offCtx.clearRect(0, 0, cssWidth, cssHeight);
    if (this.pattern === 'dots') {
      this.renderDots(offCtx, camera, cssWidth, cssHeight);
    } else if (this.pattern === 'grid') {
      this.renderGrid(offCtx, camera, cssWidth, cssHeight);
    }

    this.lastZoom = keyZoom;
    this.lastOffsetX = keyX;
    this.lastOffsetY = keyY;
    this.lastWidth = cssWidth;
    this.lastHeight = cssHeight;

    ctx.drawImage(this.cachedCanvas as CanvasImageSource, 0, 0);
    ctx.restore();
  }

  private ensureCachedCanvas(cssWidth: number, cssHeight: number, dpr: number): void {
    if (
      this.cachedCanvas !== null &&
      this.lastWidth === cssWidth &&
      this.lastHeight === cssHeight
    ) {
      return;
    }

    const physWidth = Math.round(cssWidth * dpr);
    const physHeight = Math.round(cssHeight * dpr);

    if (typeof OffscreenCanvas !== 'undefined') {
      this.cachedCanvas = new OffscreenCanvas(physWidth, physHeight);
    } else if (typeof document !== 'undefined') {
      const el = document.createElement('canvas');
      el.width = physWidth;
      el.height = physHeight;
      this.cachedCanvas = el;
    } else {
      // No offscreen canvas support available; fall back to direct rendering
      this.cachedCanvas = null;
      this.cachedCtx = null;
      return;
    }

    const offCtx = this.cachedCanvas.getContext('2d');
    if (offCtx !== null) {
      (offCtx as CanvasRenderingContext2D).scale(dpr, dpr);
    }
    this.cachedCtx = offCtx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

    // Force re-render on next frame since canvas was recreated
    this.lastZoom = -1;
  }

  private adaptSpacing(baseSpacing: number, zoom: number): number {
    let spacing = baseSpacing * zoom;
    while (spacing < MIN_PATTERN_SPACING) {
      spacing *= 2;
    }
    return spacing;
  }

  private renderDots(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    width: number,
    height: number,
  ): void {
    const spacing = this.adaptSpacing(this.spacing, camera.zoom);
    const offsetX = camera.position.x % spacing;
    const offsetY = camera.position.y % spacing;
    const radius = this.dotRadius * Math.min(camera.zoom, 2);

    ctx.fillStyle = this.color;
    ctx.beginPath();

    for (let x = offsetX; x < width; x += spacing) {
      for (let y = offsetY; y < height; y += spacing) {
        ctx.moveTo(x + radius, y);
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      }
    }

    ctx.fill();
  }

  private renderGrid(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    width: number,
    height: number,
  ): void {
    const spacing = this.adaptSpacing(this.spacing, camera.zoom);
    const offsetX = camera.position.x % spacing;
    const offsetY = camera.position.y % spacing;
    const lineW = this.lineWidth * Math.min(camera.zoom, 2);

    ctx.fillStyle = this.color;

    for (let x = offsetX; x < width; x += spacing) {
      ctx.fillRect(x, 0, lineW, height);
    }

    for (let y = offsetY; y < height; y += spacing) {
      ctx.fillRect(0, y, width, lineW);
    }
  }
}
