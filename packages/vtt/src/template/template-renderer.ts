import type { CanvasElement } from '@fieldnotes/core';
import type { GridElement, TemplateElement, HexOrientation } from '../elements/types';
import {
  getHexCellsInRadius,
  getHexCellsInCone,
  getHexCellsInLine,
  getHexCellsInSquare,
  getHexCellsInRectangle,
  drawHexPath,
} from '../grid/hex-fill';
import { renderTemplateFeetLabel } from './template-measure';
import { getHexVertices, getSquareGridLines, getHexCenters } from '../grid/grid-renderer';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const n = (v: number): string => (Number.isFinite(v) ? `${Math.round(v * 1000) / 1000}` : '0');

function findGridInStore(allElements: readonly CanvasElement[]): GridElement | null {
  for (const el of allElements) {
    if (el.type === 'extension' && el.extensionType === 'vtt:grid') {
      return {
        type: 'grid',
        id: el.id,
        position: el.position,
        zIndex: el.zIndex,
        locked: el.locked,
        layerId: el.layerId,
        gridType: el.data['gridType'] as GridElement['gridType'],
        hexOrientation: el.data['hexOrientation'] as HexOrientation,
        cellSize: el.data['cellSize'] as number,
        strokeColor: el.data['strokeColor'] as string,
        strokeWidth: el.data['strokeWidth'] as number,
        opacity: el.data['opacity'] as number,
      };
    }
  }
  return null;
}

export function renderTemplate(
  ctx: CanvasRenderingContext2D,
  template: TemplateElement,
  allElements: readonly CanvasElement[],
): void {
  const grid = findGridInStore(allElements);
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

    case 'rectangle': {
      const halfW = (template.width ?? 0) / 2;
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
    case 'rectangle': {
      const widthCells = (template.width ?? 0) / snapUnit;
      cells = getHexCellsInRectangle(
        center,
        template.angle,
        radiusCells,
        widthCells,
        cellSize,
        orientation,
      );
      break;
    }
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

// ─── SVG export ──────────────────────────────────────────────────────────────

export function emitTemplateSvg(
  template: TemplateElement,
  allElements: readonly CanvasElement[],
): string {
  const grid = findGridInStore(allElements);
  if (grid && grid.gridType === 'hex') {
    return emitHexTemplateSvg(template, grid);
  }
  return emitGeometricTemplateSvg(template);
}

function emitGeometricTemplateSvg(t: TemplateElement): string {
  const { x: cx, y: cy } = t.position;
  const r = t.radius;
  const fill = esc(t.fillColor);
  const stroke = esc(t.strokeColor);
  const sw = n(t.strokeWidth);
  const op = n(t.opacity);
  const attrs = `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${op}"`;

  switch (t.templateShape) {
    case 'circle':
      return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" ${attrs} />`;
    case 'square':
      return `<rect x="${n(cx - r / 2)}" y="${n(cy - r / 2)}" width="${n(r)}" height="${n(r)}" ${attrs} />`;
    case 'cone': {
      const halfAngle = Math.atan(0.5);
      const a0 = t.angle - halfAngle;
      const a1 = t.angle + halfAngle;
      const p0x = cx + r * Math.cos(a0);
      const p0y = cy + r * Math.sin(a0);
      const p1x = cx + r * Math.cos(a1);
      const p1y = cy + r * Math.sin(a1);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      return `<path d="M${n(cx)} ${n(cy)} L${n(p0x)} ${n(p0y)} A${n(r)} ${n(r)} 0 ${large} 1 ${n(p1x)} ${n(p1y)} Z" ${attrs} />`;
    }
    case 'line': {
      const halfW = r / 12;
      const cos = Math.cos(t.angle);
      const sin = Math.sin(t.angle);
      const perpX = -sin * halfW;
      const perpY = cos * halfW;
      const pts = [
        [cx + perpX, cy + perpY],
        [cx + r * cos + perpX, cy + r * sin + perpY],
        [cx + r * cos - perpX, cy + r * sin - perpY],
        [cx - perpX, cy - perpY],
      ]
        .map(([px, py]) => `${n(px ?? 0)},${n(py ?? 0)}`)
        .join(' ');
      return `<polygon points="${pts}" ${attrs} />`;
    }
    case 'rectangle': {
      const halfW = (t.width ?? 0) / 2;
      const cos = Math.cos(t.angle);
      const sin = Math.sin(t.angle);
      const perpX = -sin * halfW;
      const perpY = cos * halfW;
      const pts = [
        [cx + perpX, cy + perpY],
        [cx + r * cos + perpX, cy + r * sin + perpY],
        [cx + r * cos - perpX, cy + r * sin - perpY],
        [cx - perpX, cy - perpY],
      ]
        .map(([px, py]) => `${n(px ?? 0)},${n(py ?? 0)}`)
        .join(' ');
      return `<polygon points="${pts}" ${attrs} />`;
    }
  }
}

function emitHexTemplateSvg(t: TemplateElement, grid: GridElement): string {
  const cellSize = grid.cellSize;
  const orientation = grid.hexOrientation;
  const snapUnit = Math.sqrt(3) * cellSize;
  const radiusCells = t.radius / snapUnit;
  const center = t.position;

  let cells: { x: number; y: number }[];
  switch (t.templateShape) {
    case 'circle':
      cells = getHexCellsInRadius(center, radiusCells, cellSize, orientation);
      break;
    case 'cone':
      cells = getHexCellsInCone(center, t.angle, radiusCells, cellSize, orientation);
      break;
    case 'line':
      cells = getHexCellsInLine(center, t.angle, radiusCells, cellSize, orientation);
      break;
    case 'square':
      cells = getHexCellsInSquare(center, radiusCells, cellSize, orientation);
      break;
    case 'rectangle': {
      const widthCells = (t.width ?? 0) / snapUnit;
      cells = getHexCellsInRectangle(
        center,
        t.angle,
        radiusCells,
        widthCells,
        cellSize,
        orientation,
      );
      break;
    }
  }

  let d = '';
  for (const cell of cells) {
    const verts = getHexVertices(cell.x, cell.y, cellSize, orientation);
    const first = verts[0];
    if (!first) continue;
    d += `M${n(first.x)} ${n(first.y)}`;
    for (let i = 1; i < verts.length; i++) {
      const v = verts[i];
      if (v) d += `L${n(v.x)} ${n(v.y)}`;
    }
    d += 'Z';
  }
  return `<path d="${d}" fill="${esc(t.fillColor)}" stroke="${esc(t.strokeColor)}" stroke-width="${n(t.strokeWidth)}" opacity="${n(t.opacity)}" />`;
}

// ─── Grid SVG export ─────────────────────────────────────────────────────────

export function emitGridSvg(
  grid: GridElement,
  viewBox: { x: number; y: number; w: number; h: number },
): string {
  if (grid.cellSize <= 0) return '';
  const vb = {
    minX: viewBox.x,
    minY: viewBox.y,
    maxX: viewBox.x + viewBox.w,
    maxY: viewBox.y + viewBox.h,
  };
  const stroke = esc(grid.strokeColor);
  const sw = n(grid.strokeWidth);
  const op = n(grid.opacity);

  if (grid.gridType === 'hex') {
    const centers = getHexCenters(vb, grid.cellSize, grid.hexOrientation);
    let d = '';
    for (const c of centers) {
      const verts = getHexVertices(c.x, c.y, grid.cellSize, grid.hexOrientation);
      const first = verts[0];
      if (!first) continue;
      d += `M${n(first.x)} ${n(first.y)}`;
      for (let i = 1; i < verts.length; i++) {
        const v = verts[i];
        if (v) d += `L${n(v.x)} ${n(v.y)}`;
      }
      d += 'Z';
    }
    return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" opacity="${op}" />`;
  }

  const { verticals, horizontals } = getSquareGridLines(vb, grid.cellSize);
  let d = '';
  for (const gx of verticals) d += `M${n(gx)} ${n(vb.minY)}L${n(gx)} ${n(vb.maxY)}`;
  for (const gy of horizontals) d += `M${n(vb.minX)} ${n(gy)}L${n(vb.maxX)} ${n(gy)}`;
  return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" opacity="${op}" />`;
}
