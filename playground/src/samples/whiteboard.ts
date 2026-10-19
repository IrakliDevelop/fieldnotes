import { createArrow, createNote, createShape, createStroke, createText } from '@fieldnotes/core';
import type { Viewport } from '@fieldnotes/core';

const NOTES = [
  'Pick a tool from the bar above — or press 1–9.',
  'Space-drag or two fingers to pan. Pinch or Ctrl+scroll to zoom.',
  'Double-click an arrow to label it. Select things to style them on the left.',
  'Click Collaborate (top right) to open a second, synced tab.',
];

/** Replaces the board with the welcome sample as one undo step and fits the view. */
export function buildWhiteboardSample(viewport: Viewport): void {
  const { store, layerManager } = viewport;
  viewport.transaction(() => {
    for (const el of store.getAll()) store.remove(el.id);
    const [bottom, second, ...extra] = layerManager.getLayers();
    if (!bottom) throw new Error('Viewport has no layers');
    for (const layer of extra) layerManager.removeLayer(layer.id);
    const sketchId = bottom.id;
    layerManager.renameLayer(sketchId, 'Sketch');
    const notesId = second?.id ?? layerManager.createLayer('Notes').id;
    layerManager.renameLayer(notesId, 'Notes');
    for (const id of [sketchId, notesId]) {
      layerManager.setLayerVisible(id, true);
      layerManager.setLayerLocked(id, false);
      layerManager.setLayerOpacity(id, 1);
    }

    const rect = createShape({
      position: { x: 0, y: 360 },
      size: { w: 180, h: 110 },
      shape: 'rectangle',
      fillColor: '#e3f2fd',
      layerId: sketchId,
    });
    const ellipse = createShape({
      position: { x: 480, y: 360 },
      size: { w: 180, h: 110 },
      shape: 'ellipse',
      fillColor: '#fff3e0',
      layerId: sketchId,
    });
    for (const el of [
      createText({
        position: { x: 0, y: 0 },
        size: { w: 640, h: 56 },
        text: 'Field Notes playground',
        fontSize: 40,
        layerId: notesId,
      }),
      ...NOTES.map((text, i) =>
        createNote({
          position: { x: i * 220, y: 100 },
          size: { w: 200, h: 200 },
          text,
          layerId: notesId,
        }),
      ),
      rect,
      ellipse,
      createArrow({
        from: { x: 180, y: 415 },
        to: { x: 480, y: 415 },
        fromBinding: { elementId: rect.id },
        toBinding: { elementId: ellipse.id },
        label: 'connects',
        layerId: sketchId,
      }),
      createStroke({
        position: { x: 0, y: 540 },
        points: [
          { x: 0, y: 20, pressure: 0.3 },
          { x: 60, y: 0, pressure: 0.6 },
          { x: 120, y: 30, pressure: 0.9 },
          { x: 180, y: 10, pressure: 0.5 },
        ],
        color: '#1e88e5',
        width: 4,
        layerId: sketchId,
      }),
    ]) {
      store.add(el);
    }
  });
  viewport.fitToContent();
}
