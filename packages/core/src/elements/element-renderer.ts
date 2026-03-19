import type { CanvasElement, StrokeElement, ArrowElement } from './types';
import { getArrowControlPoint, getArrowTangentAngle } from './arrow-geometry';

const DOM_ELEMENT_TYPES = new Set(['note', 'image', 'html']);
const ARROWHEAD_LENGTH = 12;
const ARROWHEAD_ANGLE = Math.PI / 6;

export class ElementRenderer {
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
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = stroke.opacity;

    ctx.beginPath();
    const first = stroke.points[0];
    if (first) {
      ctx.moveTo(first.x, first.y);
    }
    for (let i = 1; i < stroke.points.length; i++) {
      const pt = stroke.points[i];
      if (pt) {
        ctx.lineTo(pt.x, pt.y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  private renderArrow(ctx: CanvasRenderingContext2D, arrow: ArrowElement): void {
    ctx.save();
    ctx.strokeStyle = arrow.color;
    ctx.lineWidth = arrow.width;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(arrow.from.x, arrow.from.y);

    if (arrow.bend !== 0) {
      const cp = getArrowControlPoint(arrow.from, arrow.to, arrow.bend);
      ctx.quadraticCurveTo(cp.x, cp.y, arrow.to.x, arrow.to.y);
    } else {
      ctx.lineTo(arrow.to.x, arrow.to.y);
    }
    ctx.stroke();

    this.renderArrowhead(ctx, arrow);
    ctx.restore();
  }

  private renderArrowhead(ctx: CanvasRenderingContext2D, arrow: ArrowElement): void {
    const angle = getArrowTangentAngle(arrow.from, arrow.to, arrow.bend, 1);

    ctx.beginPath();
    ctx.moveTo(arrow.to.x, arrow.to.y);
    ctx.lineTo(
      arrow.to.x - ARROWHEAD_LENGTH * Math.cos(angle - ARROWHEAD_ANGLE),
      arrow.to.y - ARROWHEAD_LENGTH * Math.sin(angle - ARROWHEAD_ANGLE),
    );
    ctx.lineTo(
      arrow.to.x - ARROWHEAD_LENGTH * Math.cos(angle + ARROWHEAD_ANGLE),
      arrow.to.y - ARROWHEAD_LENGTH * Math.sin(angle + ARROWHEAD_ANGLE),
    );
    ctx.closePath();
    ctx.fillStyle = arrow.color;
    ctx.fill();
  }
}
