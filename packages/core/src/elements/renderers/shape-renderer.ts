import type { ShapeElement } from '../types';
import { lineEndpoints } from '../shape-geometry';

export function renderShape(ctx: CanvasRenderingContext2D, shape: ShapeElement): void {
  ctx.save();

  if (shape.fillColor !== 'none' && shape.shape !== 'line') {
    ctx.fillStyle = shape.fillColor;
    fillShapePath(ctx, shape);
  }

  if (shape.strokeWidth > 0) {
    ctx.strokeStyle = shape.strokeColor;
    ctx.lineWidth = shape.strokeWidth;
    strokeShapePath(ctx, shape);
  }

  ctx.restore();
}

function fillShapePath(ctx: CanvasRenderingContext2D, shape: ShapeElement): void {
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

function strokeShapePath(ctx: CanvasRenderingContext2D, shape: ShapeElement): void {
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
    case 'line': {
      const [a, b] = lineEndpoints(shape);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      break;
    }
  }
}
