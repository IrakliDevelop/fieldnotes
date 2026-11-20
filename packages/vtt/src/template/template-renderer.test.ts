import { describe, expect, it, vi } from 'vitest';
import { resolveTheme } from '@fieldnotes/core';
import type { CanvasElement, Point } from '@fieldnotes/core';
import type { HexOrientation } from '../elements/types';
import { createTemplate } from '../elements/element-factory';
import { emitTemplateSvg, renderTemplate } from './template-renderer';

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

describe('template colors', () => {
  it('adapts canvas and SVG colors through the supplied adapter', () => {
    const template = createTemplate({
      position: { x: 0, y: 0 },
      templateShape: 'circle',
      radius: 20,
    });
    const styles: string[] = [];
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      set globalAlpha(value: number) {
        void value;
      },
      set fillStyle(value: string) {
        styles.push(value);
      },
      set strokeStyle(value: string) {
        styles.push(value);
      },
      set lineWidth(value: number) {
        void value;
      },
    } as unknown as CanvasRenderingContext2D;

    renderTemplate(ctx, template, [], resolveTheme('dark').adapt);

    expect(styles).toEqual(['rgba(184, 55, 10, 0.2)', '#b8370a']);
    expect(emitTemplateSvg(template, [], resolveTheme('dark').adapt)).toContain(
      'fill="rgba(184, 55, 10, 0.2)" stroke="#b8370a"',
    );
  });

  it('keeps stored canvas and SVG colors without an adapter', () => {
    const template = createTemplate({
      position: { x: 0, y: 0 },
      templateShape: 'circle',
      radius: 20,
    });
    const styles: string[] = [];
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      set globalAlpha(value: number) {
        void value;
      },
      set fillStyle(value: string) {
        styles.push(value);
      },
      set strokeStyle(value: string) {
        styles.push(value);
      },
      set lineWidth(value: number) {
        void value;
      },
    } as unknown as CanvasRenderingContext2D;

    renderTemplate(ctx, template, []);

    expect(styles).toEqual(['rgba(255, 87, 34, 0.2)', '#FF5722']);
    expect(emitTemplateSvg(template, [])).toContain(
      'fill="rgba(255, 87, 34, 0.2)" stroke="#FF5722"',
    );
  });

  it.each([
    ['dark', resolveTheme('dark').adapt, 'rgba(184, 55, 10, 0.2)', '#b8370a'],
    ['identity', undefined, 'rgba(255, 87, 34, 0.2)', '#FF5722'],
  ] as const)(
    'uses %s colors for every hex canvas path and SVG output',
    (_name, adapt, fillColor, strokeColor) => {
      const operations: { name: 'fill' | 'stroke'; fillStyle: string; strokeStyle: string }[] = [];
      let activeFill = '';
      let activeStroke = '';
      const ctx = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        roundRect: vi.fn(),
        fill: () =>
          operations.push({ name: 'fill', fillStyle: activeFill, strokeStyle: activeStroke }),
        stroke: () =>
          operations.push({ name: 'stroke', fillStyle: activeFill, strokeStyle: activeStroke }),
        setLineDash: vi.fn(),
        measureText: () => ({ width: 30 }),
        set globalAlpha(value: number) {
          void value;
        },
        set lineWidth(value: number) {
          void value;
        },
        set font(value: string) {
          void value;
        },
        set textAlign(value: CanvasTextAlign) {
          void value;
        },
        set textBaseline(value: CanvasTextBaseline) {
          void value;
        },
        set fillStyle(value: string) {
          activeFill = value;
        },
        set strokeStyle(value: string) {
          activeStroke = value;
        },
        fillText: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
      const template = createTemplate({
        position: { x: 1000, y: 390 },
        templateShape: 'circle',
        radius: 96,
        radiusFeet: 10,
      });

      renderTemplate(ctx, template, [hexGrid('pointy')], adapt);

      expect(operations.slice(0, 5)).toEqual([
        { name: 'fill', fillStyle: fillColor, strokeStyle: '' },
        { name: 'stroke', fillStyle: fillColor, strokeStyle: strokeColor },
        { name: 'fill', fillStyle: strokeColor, strokeStyle: strokeColor },
        { name: 'stroke', fillStyle: strokeColor, strokeStyle: strokeColor },
        { name: 'stroke', fillStyle: strokeColor, strokeStyle: strokeColor },
      ]);
      expect(emitTemplateSvg(template, [hexGrid('pointy')], adapt)).toContain(
        `fill="${fillColor}" stroke="${strokeColor}"`,
      );
    },
  );
});
