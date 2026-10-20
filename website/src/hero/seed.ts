import type { StrokePoint } from '@fieldnotes/core';

const SAMPLE_PX = 4;

/** Samples each subpath of the static sketch every 4 CSS px, in CSS px relative to `origin`. */
export function sampleSketch(
  svg: SVGSVGElement,
  origin: { x: number; y: number },
): StrokePoint[][] {
  const ctm = svg.getScreenCTM();
  if (!ctm) throw new Error('the hero sketch is not rendered');
  const paths = [...svg.querySelectorAll('path')];
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  svg.append(probe);
  const strokes: StrokePoint[][] = [];
  for (const path of paths) {
    // getPointAtLength jumps between subpaths, so each subpath becomes its own stroke.
    for (const d of (path.getAttribute('d') ?? '').split(/(?=M)/)) {
      probe.setAttribute('d', d);
      const length = probe.getTotalLength();
      const steps = Math.max(1, Math.ceil((length * ctm.a) / SAMPLE_PX));
      const points: StrokePoint[] = [];
      for (let i = 0; i <= steps; i++) {
        const screen = probe.getPointAtLength((length * i) / steps).matrixTransform(ctm);
        points.push({ x: screen.x - origin.x, y: screen.y - origin.y, pressure: 0.5 });
      }
      strokes.push(points);
    }
  }
  probe.remove();
  return strokes;
}
