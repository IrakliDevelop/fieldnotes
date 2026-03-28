import type {
  CanvasElement,
  StrokeElement,
  ArrowElement,
  ShapeElement,
  ImageElement,
  GridElement,
} from './types';
import { getArrowControlPoint, getArrowTangentAngle } from './arrow-geometry';
import { getEdgeIntersection } from './arrow-binding';
import { getElementBounds } from './element-bounds';
import { getStrokeRenderData } from './stroke-cache';
import type { ElementStore } from './element-store';
import { renderSquareGrid, renderHexGrid } from './grid-renderer';
import type { Camera } from '../canvas/camera';

const DOM_ELEMENT_TYPES = new Set(['note', 'html', 'text']);
const ARROWHEAD_LENGTH = 12;
const ARROWHEAD_ANGLE = Math.PI / 6;

export class ElementRenderer {
  private store: ElementStore | null = null;
  private imageCache = new Map<string, HTMLImageElement>();
  private onImageLoad: (() => void) | null = null;
  private camera: Camera | null = null;
  private canvasSize: { w: number; h: number } | null = null;

  setStore(store: ElementStore): void {
    this.store = store;
  }

  setOnImageLoad(callback: () => void): void {
    this.onImageLoad = callback;
  }

  setCamera(camera: Camera): void {
    this.camera = camera;
  }

  setCanvasSize(w: number, h: number): void {
    this.canvasSize = { w, h };
  }

  isDomElement(element: CanvasElement): boolean {
    return DOM_ELEMENT_TYPES.has(element.type);
  }

  renderCanvasElement(ctx: CanvasRenderingContext2D, element: CanvasElement): void {
    switch (element.type) {
      case 'stroke':
        this.renderStroke(ctx, element);
        break;
      case 'arrow':
        this.renderArrow(ctx, element);
        break;
      case 'shape':
        this.renderShape(ctx, element);
        break;
      case 'image':
        this.renderImage(ctx, element);
        break;
      case 'grid':
        this.renderGrid(ctx, element);
        break;
    }
  }

  private renderStroke(ctx: CanvasRenderingContext2D, stroke: StrokeElement): void {
    if (stroke.points.length < 2) return;

    ctx.save();
    ctx.translate(stroke.position.x, stroke.position.y);
    ctx.strokeStyle = stroke.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = stroke.opacity;

    const { segments, widths } = getStrokeRenderData(stroke);
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const w = widths[i];
      if (!seg || w === undefined) continue;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(seg.start.x, seg.start.y);
      ctx.bezierCurveTo(seg.cp1.x, seg.cp1.y, seg.cp2.x, seg.cp2.y, seg.end.x, seg.end.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  private renderArrow(ctx: CanvasRenderingContext2D, arrow: ArrowElement): void {
    const { visualFrom, visualTo } = this.getVisualEndpoints(arrow);

    ctx.save();
    ctx.strokeStyle = arrow.color;
    ctx.lineWidth = arrow.width;
    ctx.lineCap = 'round';

    if (arrow.fromBinding || arrow.toBinding) {
      ctx.setLineDash([8, 4]);
    }

    ctx.beginPath();
    ctx.moveTo(visualFrom.x, visualFrom.y);

    if (arrow.bend !== 0) {
      const cp = arrow.cachedControlPoint ?? getArrowControlPoint(arrow.from, arrow.to, arrow.bend);
      ctx.quadraticCurveTo(cp.x, cp.y, visualTo.x, visualTo.y);
    } else {
      ctx.lineTo(visualTo.x, visualTo.y);
    }
    ctx.stroke();

    this.renderArrowhead(ctx, arrow, visualTo);
    ctx.restore();
  }

  private renderArrowhead(
    ctx: CanvasRenderingContext2D,
    arrow: ArrowElement,
    tip: { x: number; y: number },
  ): void {
    const angle = getArrowTangentAngle(arrow.from, arrow.to, arrow.bend, 1);

    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(
      tip.x - ARROWHEAD_LENGTH * Math.cos(angle - ARROWHEAD_ANGLE),
      tip.y - ARROWHEAD_LENGTH * Math.sin(angle - ARROWHEAD_ANGLE),
    );
    ctx.lineTo(
      tip.x - ARROWHEAD_LENGTH * Math.cos(angle + ARROWHEAD_ANGLE),
      tip.y - ARROWHEAD_LENGTH * Math.sin(angle + ARROWHEAD_ANGLE),
    );
    ctx.closePath();
    ctx.fillStyle = arrow.color;
    ctx.fill();
  }

  private getVisualEndpoints(arrow: ArrowElement): {
    visualFrom: { x: number; y: number };
    visualTo: { x: number; y: number };
  } {
    let visualFrom = arrow.from;
    let visualTo = arrow.to;

    if (!this.store) return { visualFrom, visualTo };

    if (arrow.fromBinding) {
      const el = this.store.getById(arrow.fromBinding.elementId);
      if (el) {
        const bounds = getElementBounds(el);
        if (bounds) {
          const tangentAngle = getArrowTangentAngle(arrow.from, arrow.to, arrow.bend, 0);
          const rayTarget = {
            x: arrow.from.x + Math.cos(tangentAngle) * 1000,
            y: arrow.from.y + Math.sin(tangentAngle) * 1000,
          };
          visualFrom = getEdgeIntersection(bounds, rayTarget);
        }
      }
    }

    if (arrow.toBinding) {
      const el = this.store.getById(arrow.toBinding.elementId);
      if (el) {
        const bounds = getElementBounds(el);
        if (bounds) {
          const tangentAngle = getArrowTangentAngle(arrow.from, arrow.to, arrow.bend, 1);
          // Reverse tangent — at t=1 tangent points away from curve body,
          // but we need the ray from center back toward the curve
          const rayTarget = {
            x: arrow.to.x - Math.cos(tangentAngle) * 1000,
            y: arrow.to.y - Math.sin(tangentAngle) * 1000,
          };
          visualTo = getEdgeIntersection(bounds, rayTarget);
        }
      }
    }

    return { visualFrom, visualTo };
  }

  private renderShape(ctx: CanvasRenderingContext2D, shape: ShapeElement): void {
    ctx.save();

    if (shape.fillColor !== 'none') {
      ctx.fillStyle = shape.fillColor;
      this.fillShapePath(ctx, shape);
    }

    if (shape.strokeWidth > 0) {
      ctx.strokeStyle = shape.strokeColor;
      ctx.lineWidth = shape.strokeWidth;
      this.strokeShapePath(ctx, shape);
    }

    ctx.restore();
  }

  private fillShapePath(ctx: CanvasRenderingContext2D, shape: ShapeElement): void {
    switch (shape.shape) {
      case 'rectangle':
        ctx.fillRect(shape.position.x, shape.position.y, shape.size.w, shape.size.h);
        break;
      case 'ellipse': {
        const cx = shape.position.x + shape.size.w / 2;
        const cy = shape.position.y + shape.size.h / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, shape.size.w / 2, shape.size.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
  }

  private strokeShapePath(ctx: CanvasRenderingContext2D, shape: ShapeElement): void {
    switch (shape.shape) {
      case 'rectangle':
        ctx.strokeRect(shape.position.x, shape.position.y, shape.size.w, shape.size.h);
        break;
      case 'ellipse': {
        const cx = shape.position.x + shape.size.w / 2;
        const cy = shape.position.y + shape.size.h / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, shape.size.w / 2, shape.size.h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
    }
  }

  private renderGrid(ctx: CanvasRenderingContext2D, grid: GridElement): void {
    if (!this.canvasSize) return;

    const cam = this.camera;
    if (!cam) return;

    const topLeft = cam.screenToWorld({ x: 0, y: 0 });
    const bottomRight = cam.screenToWorld({
      x: this.canvasSize.w,
      y: this.canvasSize.h,
    });
    const bounds = {
      minX: topLeft.x,
      minY: topLeft.y,
      maxX: bottomRight.x,
      maxY: bottomRight.y,
    };

    if (grid.gridType === 'hex') {
      renderHexGrid(
        ctx,
        bounds,
        grid.cellSize,
        grid.hexOrientation,
        grid.strokeColor,
        grid.strokeWidth,
        grid.opacity,
      );
    } else {
      renderSquareGrid(
        ctx,
        bounds,
        grid.cellSize,
        grid.strokeColor,
        grid.strokeWidth,
        grid.opacity,
      );
    }
  }

  private renderImage(ctx: CanvasRenderingContext2D, image: ImageElement): void {
    const img = this.getImage(image.src);
    if (!img) return;
    ctx.drawImage(img, image.position.x, image.position.y, image.size.w, image.size.h);
  }

  private getImage(src: string): HTMLImageElement | null {
    const cached = this.imageCache.get(src);
    if (cached) return cached.complete ? cached : null;

    const img = new Image();
    img.src = src;
    this.imageCache.set(src, img);
    img.onload = () => this.onImageLoad?.();
    return null;
  }
}
