import type { CanvasElement, StrokeElement, ArrowElement } from './types';
import { getArrowControlPoint, getArrowTangentAngle } from './arrow-geometry';
import { getElementBounds, getEdgeIntersection } from './arrow-binding';
import { smoothToSegments, pressureToWidth } from './stroke-smoothing';
import type { ElementStore } from './element-store';

const DOM_ELEMENT_TYPES = new Set(['note', 'image', 'html', 'text']);
const ARROWHEAD_LENGTH = 12;
const ARROWHEAD_ANGLE = Math.PI / 6;

export class ElementRenderer {
  private store: ElementStore | null = null;

  setStore(store: ElementStore): void {
    this.store = store;
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
}
