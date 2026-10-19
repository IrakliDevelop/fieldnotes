import { createArrow, createNote, createShape, createStroke, createText } from '@fieldnotes/core';
import type { CanvasElement } from '@fieldnotes/core';

const NOTES = [
  'Pick a tool from the toolbar: P draws, N adds a note. Hold Space and drag to pan.',
  'Double-click an arrow to give it a label.',
  'Sample replaces the board; Undo brings your old board back.',
  'Add ?bench=2000 to the URL to stress-test rendering.',
];

/** Builds the deterministic welcome board the demo's Sample button and `?sample` load. */
export function createSampleBoard(layerId: string): CanvasElement[] {
  const rect = createShape({
    position: { x: 0, y: 360 },
    size: { w: 180, h: 110 },
    shape: 'rectangle',
    fillColor: '#e3f2fd',
    layerId,
  });
  const ellipse = createShape({
    position: { x: 480, y: 360 },
    size: { w: 180, h: 110 },
    shape: 'ellipse',
    fillColor: '#fff3e0',
    layerId,
  });
  return [
    createText({
      position: { x: 0, y: 0 },
      size: { w: 600, h: 48 },
      text: 'Field Notes playground',
      fontSize: 36,
      layerId,
    }),
    ...NOTES.map((text, i) =>
      createNote({ position: { x: i * 220, y: 100 }, size: { w: 200, h: 200 }, text, layerId }),
    ),
    rect,
    ellipse,
    createArrow({
      from: { x: 180, y: 415 },
      to: { x: 480, y: 415 },
      fromBinding: { elementId: rect.id },
      toBinding: { elementId: ellipse.id },
      label: 'drag me',
      layerId,
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
      layerId,
    }),
  ];
}
