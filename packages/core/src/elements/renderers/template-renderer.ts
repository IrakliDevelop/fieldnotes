import type { TemplateElement, HexOrientation } from '../types';
import type { ElementStore } from '../element-store';
import {
  getHexCellsInRadius,
  getHexCellsInCone,
  getHexCellsInLine,
  getHexCellsInSquare,
  drawHexPath,
} from '../hex-fill';
import { renderTemplateFeetLabel } from './template-measure';

export function renderTemplate(
  ctx: CanvasRenderingContext2D,
  template: TemplateElement,
  store: ElementStore | null,
): void {
  const grid = store?.getElementsByType('grid')[0];
  if (grid && grid.gridType === 'hex' && template.renderStyle !== 'geometric') {
    renderHexTemplate(ctx, template, grid.cellSize, grid.hexOrientation);
    return;
  }

  renderGeometricTemplate(ctx, template);
}

function renderGeometricTemplate(ctx: CanvasRenderingContext2D, template: TemplateElement): void {
  const { x: cx, y: cy } = template.position;
  const r = template.radius;

  ctx.save();
  ctx.globalAlpha = template.opacity;
  ctx.fillStyle = template.fillColor;
  ctx.strokeStyle = template.strokeColor;
  ctx.lineWidth = template.strokeWidth;

  switch (template.templateShape) {
    case 'circle':
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;

    case 'square':
      ctx.fillRect(cx - r / 2, cy - r / 2, r, r);
      ctx.strokeRect(cx - r / 2, cy - r / 2, r, r);
      break;

    case 'cone': {
      const halfAngle = Math.atan(0.5);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, template.angle - halfAngle, template.angle + halfAngle);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'line': {
      const halfW = r / 12;
      const cos = Math.cos(template.angle);
      const sin = Math.sin(template.angle);
      const perpX = -sin * halfW;
      const perpY = cos * halfW;

      ctx.beginPath();
      ctx.moveTo(cx + perpX, cy + perpY);
      ctx.lineTo(cx + r * cos + perpX, cy + r * sin + perpY);
      ctx.lineTo(cx + r * cos - perpX, cy + r * sin - perpY);
      ctx.lineTo(cx - perpX, cy - perpY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
  }

  if (template.radiusFeet != null && template.radiusFeet > 0) {
    renderTemplateFeetLabel(ctx, {
      position: template.position,
      radius: template.radius,
      angle: template.angle,
      templateShape: template.templateShape,
      feet: template.radiusFeet,
      color: template.strokeColor,
    });
  }

  ctx.restore();
}

function renderHexTemplate(
  ctx: CanvasRenderingContext2D,
  template: TemplateElement,
  cellSize: number,
  orientation: HexOrientation,
): void {
  const snapUnit = Math.sqrt(3) * cellSize;
  const radiusCells = template.radius / snapUnit;
  const center = template.position;

  let cells: { x: number; y: number }[];
  switch (template.templateShape) {
    case 'circle':
      cells = getHexCellsInRadius(center, radiusCells, cellSize, orientation);
      break;
    case 'cone':
      cells = getHexCellsInCone(center, template.angle, radiusCells, cellSize, orientation);
      break;
    case 'line':
      cells = getHexCellsInLine(center, template.angle, radiusCells, cellSize, orientation);
      break;
    case 'square':
      cells = getHexCellsInSquare(center, radiusCells, cellSize, orientation);
      break;
  }

  ctx.save();
  ctx.globalAlpha = template.opacity;

  ctx.beginPath();
  for (const cell of cells) {
    drawHexPath(ctx, cell.x, cell.y, cellSize, orientation);
  }
  ctx.fillStyle = template.fillColor;
  ctx.fill();

  ctx.beginPath();
  for (const cell of cells) {
    drawHexPath(ctx, cell.x, cell.y, cellSize, orientation);
  }
  ctx.strokeStyle = template.strokeColor;
  ctx.lineWidth = template.strokeWidth;
  ctx.stroke();

  {
    ctx.globalAlpha = Math.min(template.opacity + 0.1, 1);
    ctx.beginPath();
    drawHexPath(ctx, center.x, center.y, cellSize, orientation);
    ctx.fillStyle = template.strokeColor;
    ctx.fill();
    ctx.strokeStyle = template.strokeColor;
    ctx.lineWidth = template.strokeWidth;
    ctx.stroke();
  }

  if (template.radiusFeet != null && template.radiusFeet > 0) {
    renderTemplateFeetLabel(ctx, {
      position: template.position,
      radius: template.radius,
      angle: template.angle,
      templateShape: template.templateShape,
      feet: template.radiusFeet,
      color: template.strokeColor,
    });
  }

  ctx.restore();
}
