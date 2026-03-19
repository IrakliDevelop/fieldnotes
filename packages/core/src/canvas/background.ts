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

    if (this.pattern === 'dots') {
      this.renderDots(ctx, camera, cssWidth, cssHeight);
    } else if (this.pattern === 'grid') {
      this.renderGrid(ctx, camera, cssWidth, cssHeight);
    }

    ctx.restore();
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
