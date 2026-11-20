import { describe, it, expect, vi } from 'vitest';
import { resolveTheme } from '@fieldnotes/core';
import type { CanvasElement, ExtensionElementEnvelope } from '@fieldnotes/core';
import { gridElementTypeDefinition } from './grid-definition';

const envelope: ExtensionElementEnvelope = {
  id: 'grid-1',
  type: 'extension',
  extensionType: 'vtt:grid',
  position: { x: 0, y: 0 },
  index: 'a5',
  version: 7,
  editor: 'peer-2',
  locked: true,
  layerId: 'default',
  data: {
    gridType: 'hex',
    hexOrientation: 'flat',
    cellSize: 40,
    strokeColor: '#ccc',
    strokeWidth: 1,
    opacity: 0.5,
  },
};

describe('gridElementTypeDefinition', () => {
  it('wrap(unwrap(envelope)) preserves index, version and editor', () => {
    const rewrapped = gridElementTypeDefinition.wrap(gridElementTypeDefinition.unwrap(envelope));

    expect(rewrapped).toEqual(envelope);
  });

  it('adapts grid strokes through the render context theme', () => {
    const grid = gridElementTypeDefinition.unwrap({
      ...envelope,
      data: { ...envelope.data, gridType: 'square', strokeColor: '#000000' },
    });
    const styles: string[] = [];
    const ctx = {
      globalAlpha: 1,
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      set strokeStyle(value: string) {
        styles.push(value);
      },
      set lineWidth(value: number) {
        void value;
      },
    } as unknown as CanvasRenderingContext2D;

    gridElementTypeDefinition.render?.(ctx, grid, [] as readonly CanvasElement[], undefined, {
      theme: resolveTheme('dark'),
    });

    expect(styles).toEqual(['#ededed']);
    expect(
      gridElementTypeDefinition.emitSvg?.(
        grid,
        [],
        { x: 0, y: 0, w: 40, h: 40 },
        {
          theme: resolveTheme('dark'),
        },
      ),
    ).toContain('stroke="#ededed"');
  });

  it('keeps grid strokes unchanged without a render context', () => {
    const grid = gridElementTypeDefinition.unwrap({
      ...envelope,
      data: { ...envelope.data, gridType: 'square', strokeColor: '#000000' },
    });
    const styles: string[] = [];
    const ctx = {
      globalAlpha: 1,
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      set strokeStyle(value: string) {
        styles.push(value);
      },
      set lineWidth(value: number) {
        void value;
      },
    } as unknown as CanvasRenderingContext2D;

    gridElementTypeDefinition.render?.(ctx, grid, []);

    expect(styles).toEqual(['#000000']);
  });
});
