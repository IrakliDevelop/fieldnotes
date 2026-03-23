import type {
  CanvasElement,
  StrokeElement,
  ArrowElement,
  ShapeElement,
  ImageElement,
} from './types';
import { getArrowControlPoint, getArrowTangentAngle } from './arrow-geometry';
import { getElementBounds, getEdgeIntersection } from './arrow-binding';
import { smoothToSegments, pressureToWidth } from './stroke-smoothing';
import type { ElementStore } from './element-store';

const DOM_ELEMENT_TYPES = new Set(['note', 'html', 'text']);
const ARROWHEAD_LENGTH = 12;
const ARROWHEAD_ANGLE = Math.PI / 6;

export class ElementRenderer {
  private store: ElementStore | null = null;
  private imageCache = new Map<string, HTMLImageElement>();
  private onImageLoad: (() => void) | null = null;

  setStore(store: ElementStore): void {
    this.store = store;
  }

  setOnImageLoad(callback: () => void): void {
    this.onImageLoad = callback;
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

    const segments = smoothToSegments(stroke.points);
    for (const seg of segments) {
      const w =
        (pressureToWidth(seg.start.pressure, stroke.width) +
          pressureToWidth(seg.end.pressure, stroke.width)) /
        2;
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
      const cp = getArrowControlPoint(arrow.from, arrow.to, arrow.bend);
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
