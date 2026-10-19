import { createText } from '@fieldnotes/core';
import type { Viewport } from '@fieldnotes/core';
import { insertWidget, WIDGETS } from '../widgets';

const GAP = 40;

/** Replaces the board with one of each widget under a title, as one undo step, and fits the view. */
export function buildEmbedsSample(viewport: Viewport): void {
  const { store } = viewport;
  viewport.transaction(() => {
    for (const el of store.getAll()) store.remove(el.id);
    store.add(
      createText({
        position: { x: 0, y: 0 },
        size: { w: 640, h: 56 },
        text: 'Interactive HTML on the canvas',
        fontSize: 40,
        layerId: viewport.layerManager.activeLayerId,
      }),
    );
    let x = 0;
    for (const def of WIDGETS) {
      insertWidget(viewport, def, { x, y: 100 });
      x += def.size.w + GAP;
    }
  });
  viewport.fitToContent();
}
