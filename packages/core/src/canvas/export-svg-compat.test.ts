// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { exportSvg } from './export-svg';
import { createArrow, createImage, createShape, createStroke } from '../elements/element-factory';
import { ElementStore } from '../elements/element-store';

describe('exportSvg compatibility', () => {
  it('exportSvg keeps the SVG of strokes, shapes, bound arrows and data images unchanged', async () => {
    const store = new ElementStore();
    const rectangle = createShape({
      position: { x: 50, y: 20 },
      size: { w: 80, h: 60 },
      shape: 'rectangle',
      fillColor: '#00ff00',
      strokeColor: '#0000ff',
      strokeWidth: 2,
    });
    const image = createImage({
      position: { x: 200, y: 40 },
      size: { w: 40, h: 30 },
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WAAAAABJRU5ErkJggg==',
    });
    store.add(
      createStroke({
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 20, y: 10, pressure: 0.5 },
          { x: 40, y: 0, pressure: 0.5 },
        ],
        width: 4,
        color: '#ff0000',
      }),
    );
    store.add(rectangle);
    store.add(image);
    store.add(
      createArrow({
        from: { x: 90, y: 50 },
        to: { x: 220, y: 55 },
        bend: 0,
        fromBinding: { elementId: rectangle.id },
        toBinding: { elementId: image.id },
      }),
    );

    const svg = await exportSvg(store, { padding: 5 });

    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="252" height="92" viewBox="-7 -7 252 92"><path d="M0 0 C3.333 1.667 13.333 10 20 10 M20 10 C26.667 10 36.667 1.667 40 0" fill="none" stroke="#ff0000" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" opacity="1" /><rect x="50" y="20" width="80" height="60" fill="#00ff00" stroke="#0000ff" stroke-width="2" /><image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WAAAAABJRU5ErkJggg==" x="200" y="40" width="40" height="30" /><path d="M130 51.538 L200 54.231" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" /><polygon points="200,54.231 189.385,59.827 189.846,47.836" fill="#000000" /></svg>',
    );
  });
});
