import type { CanvasElement } from './types';

/** Patch that translates an element by (dx, dy). Arrows move position + from + to;
 * every other type moves position only (strokes carry points relative to position). */
export function translateElementPatch(
  el: CanvasElement,
  dx: number,
  dy: number,
): Partial<CanvasElement> {
  const position = { x: el.position.x + dx, y: el.position.y + dy };
  if (el.type === 'arrow') {
    return {
      position,
      from: { x: el.from.x + dx, y: el.from.y + dy },
      to: { x: el.to.x + dx, y: el.to.y + dy },
    };
  }
  return { position };
}
