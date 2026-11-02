import { describe, expect, it } from 'vitest';
import { createNote, createShape } from '../elements/element-factory';
import { ElementStore } from '../elements/element-store';
import { createFrame } from '../elements/frame-element';
import { framePresentationSlides } from './presentation';

function slidesStore() {
  const store = new ElementStore();
  const frameLate = {
    ...createFrame({
      position: { x: 50, y: 60 },
      size: { w: 200, h: 124 },
      layerId: 'a',
      index: 'a1',
    }),
    id: 'frame-late',
  };
  const frameEarly = {
    ...createFrame({
      position: { x: 10, y: 20 },
      size: { w: 100, h: 80 },
      layerId: 'a',
      index: 'a0',
    }),
    id: 'frame-early',
  };
  const frameHidden = {
    ...createFrame({
      position: { x: 90, y: 100 },
      size: { w: 300, h: 124 },
      layerId: 'b',
      index: 'a0',
    }),
    id: 'frame-hidden',
  };

  store.add(frameLate);
  store.add(frameEarly);
  store.add(createNote({ position: { x: 0, y: 0 }, layerId: 'a', index: 'a2' }));
  store.add(frameHidden);
  store.add(
    createShape({
      position: { x: 20, y: 30 },
      size: { w: 10, h: 10 },
      layerId: 'a',
      index: 'a0',
      parentId: frameEarly.id,
    }),
  );
  store.setLayerOrder(
    new Map([
      ['a', 0],
      ['b', 1],
    ]),
  );

  return { store, frameEarly, frameLate };
}

describe('framePresentationSlides', () => {
  it('lists frames in scene order with content views', () => {
    const { store, frameEarly, frameLate } = slidesStore();

    expect(framePresentationSlides(store, (id) => id !== 'b')).toEqual([
      { view: { x: 10, y: 44, w: 100, h: 56 }, frameId: frameEarly.id },
      { view: { x: 50, y: 84, w: 200, h: 100 }, frameId: frameLate.id },
    ]);
  });

  it('follows bringToFront', () => {
    const { store, frameEarly, frameLate } = slidesStore();
    store.bringToFront(frameEarly.id);

    expect(framePresentationSlides(store, (id) => id !== 'b')).toEqual([
      { view: { x: 50, y: 84, w: 200, h: 100 }, frameId: frameLate.id },
      { view: { x: 10, y: 44, w: 100, h: 56 }, frameId: frameEarly.id },
    ]);
  });
});
