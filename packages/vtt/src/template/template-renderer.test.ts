import { describe, expect, it, vi } from 'vitest';
import type { CanvasElement, Point } from '@fieldnotes/core';
import type { HexOrientation } from '../elements/types';
import { createTemplate } from '../elements/element-factory';
import { renderTemplate } from './template-renderer';

function recordingCtx(): { ctx: CanvasRenderingContext2D; paths: Point[][] } {
  const paths: Point[][] = [];
  const point = (x: number, y: number): void => {
    paths[paths.length - 1]?.push({ x, y });
  };
  const noop = vi.fn();
  const ctx = {
    beginPath: () => paths.push([]),
    moveTo: point,
    lineTo: point,
    closePath: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    setLineDash: noop,
    roundRect: noop,
    fillText: noop,
    measureText: () => ({ width: 30 }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, paths };
}

function hexGrid(hexOrientation: HexOrientation): CanvasElement {
  return {
    id: 'grid-1',
    type: 'extension',
    extensionType: 'vtt:grid',
    position: { x: 0, y: 0 },
    index: 'a0',
    version: 1,
    locked: true,
    layerId: 'default',
    data: {
      gridType: 'hex',
      hexOrientation,
      cellSize: 48,
      strokeColor: '#ccc',
      strokeWidth: 1,
      opacity: 0.5,
    },
  };
}

function centroid(points: Point[]): Point {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

const hexW = Math.sqrt(3) * 48;

describe('renderTemplate on a hex grid', () => {
  it.each([
    ['pointy', { x: 12 * hexW + hexW / 2, y: 5 * 72 }],
    ['flat', { x: 14 * 72, y: 5 * hexW }],
  ] as const)(
    'draws the %s center marker and label on the snapped center cell, not the raw position',
    (orientation, expected) => {
      const { ctx, paths } = recordingCtx();
      const template = createTemplate({
        position: { x: 1000, y: 390 },
        templateShape: 'circle',
        radius: 96,
        radiusFeet: 10,
      });

      renderTemplate(ctx, template, [hexGrid(orientation)]);

      const marker = paths.find((p) => p.length === 6);
      if (!marker) throw new Error('no single-hex marker path');
      expect(centroid(marker).x).toBeCloseTo(expected.x, 2);
      expect(centroid(marker).y).toBeCloseTo(expected.y, 2);
      const labelStart = paths.find((p) => p.length === 2)?.[0];
      if (!labelStart) throw new Error('no label line path');
      expect(labelStart.x).toBeCloseTo(expected.x, 2);
      expect(labelStart.y).toBeCloseTo(expected.y, 2);
    },
  );
});
