/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Viewport } from './viewport';
import {
  createNote,
  createStroke,
  createArrow,
  createImage,
  createText,
  createShape,
} from '../elements/element-factory';
import type {
  NoteElement,
  StrokeElement,
  ArrowElement,
  ImageElement,
  TextElement,
  ShapeElement,
  GridElement,
} from '../elements/types';

describe('Viewport save/load roundtrip', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    });
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('roundtrips multiple element types with camera state', () => {
    const v1 = new Viewport(container);
    const layerId = v1.layerManager.activeLayerId;

    const note = createNote({
      position: { x: 10, y: 20 },
      size: { w: 200, h: 100 },
      text: '<b>Hello</b>',
      backgroundColor: '#ff0000',
      textColor: '#ffffff',
      fontSize: 24,
      layerId,
    });
    const stroke = createStroke({
      points: [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 50, y: 50, pressure: 0.8 },
      ],
      color: '#00ff00',
      width: 4,
      opacity: 0.7,
      layerId,
    });
    const arrow = createArrow({
      from: { x: 100, y: 100 },
      to: { x: 300, y: 200 },
      bend: 0.3,
      color: '#0000ff',
      width: 3,
      layerId,
    });
    const image = createImage({
      position: { x: 400, y: 50 },
      size: { w: 150, h: 120 },
      src: 'data:image/png;base64,abc',
      layerId,
    });
    const text = createText({
      position: { x: 50, y: 300 },
      size: { w: 180, h: 40 },
      text: 'Caption',
      fontSize: 20,
      color: '#333',
      textAlign: 'center',
      layerId,
    });
    const shape = createShape({
      position: { x: 500, y: 500 },
      size: { w: 80, h: 60 },
      shape: 'ellipse',
      strokeColor: '#111',
      strokeWidth: 3,
      fillColor: '#eee',
      layerId,
    });

    v1.store.add(note);
    v1.store.add(stroke);
    v1.store.add(arrow);
    v1.store.add(image);
    v1.store.add(text);
    v1.store.add(shape);

    v1.camera.moveTo(100, 200);
    v1.camera.setZoom(1.5);

    const state = v1.exportState();
    v1.destroy();

    const v2 = new Viewport(container);
    v2.loadState(state);

    expect(v2.store.count).toBe(6);

    const rNote = v2.store.getById(note.id) as NoteElement;
    expect(rNote.type).toBe('note');
    expect(rNote.position).toEqual({ x: 10, y: 20 });
    expect(rNote.size).toEqual({ w: 200, h: 100 });
    expect(rNote.text).toBe('<b>Hello</b>');
    expect(rNote.backgroundColor).toBe('#ff0000');
    expect(rNote.textColor).toBe('#ffffff');
    expect(rNote.fontSize).toBe(24);

    const rStroke = v2.store.getById(stroke.id) as StrokeElement;
    expect(rStroke.type).toBe('stroke');
    expect(rStroke.points).toHaveLength(2);
    expect(rStroke.color).toBe('#00ff00');
    expect(rStroke.width).toBe(4);
    expect(rStroke.opacity).toBe(0.7);

    const rArrow = v2.store.getById(arrow.id) as ArrowElement;
    expect(rArrow.type).toBe('arrow');
    expect(rArrow.from).toEqual({ x: 100, y: 100 });
    expect(rArrow.to).toEqual({ x: 300, y: 200 });
    expect(rArrow.bend).toBe(0.3);
    expect(rArrow.color).toBe('#0000ff');

    const rImage = v2.store.getById(image.id) as ImageElement;
    expect(rImage.type).toBe('image');
    expect(rImage.position).toEqual({ x: 400, y: 50 });
    expect(rImage.size).toEqual({ w: 150, h: 120 });
    expect(rImage.src).toBe('data:image/png;base64,abc');

    const rText = v2.store.getById(text.id) as TextElement;
    expect(rText.type).toBe('text');
    expect(rText.text).toBe('Caption');
    expect(rText.fontSize).toBe(20);
    expect(rText.textAlign).toBe('center');

    const rShape = v2.store.getById(shape.id) as ShapeElement;
    expect(rShape.type).toBe('shape');
    expect(rShape.shape).toBe('ellipse');
    expect(rShape.strokeColor).toBe('#111');
    expect(rShape.fillColor).toBe('#eee');

    expect(v2.camera.position.x).toBe(100);
    expect(v2.camera.position.y).toBe(200);
    expect(v2.camera.zoom).toBe(1.5);

    v2.destroy();
  });

  it('preserves arrow bindings through roundtrip', () => {
    const v1 = new Viewport(container);
    const layerId = v1.layerManager.activeLayerId;

    const noteA = createNote({
      position: { x: 0, y: 0 },
      size: { w: 100, h: 100 },
      layerId,
    });
    const noteB = createNote({
      position: { x: 300, y: 300 },
      size: { w: 100, h: 100 },
      layerId,
    });
    const arrow = createArrow({
      from: { x: 50, y: 50 },
      to: { x: 350, y: 350 },
      fromBinding: { elementId: noteA.id },
      toBinding: { elementId: noteB.id },
      layerId,
    });

    v1.store.add(noteA);
    v1.store.add(noteB);
    v1.store.add(arrow);

    const state = v1.exportState();
    v1.destroy();

    const v2 = new Viewport(container);
    v2.loadState(state);

    const rArrow = v2.store.getById(arrow.id) as ArrowElement;
    expect(rArrow.fromBinding?.elementId).toBe(noteA.id);
    expect(rArrow.toBinding?.elementId).toBe(noteB.id);

    expect(v2.store.getById(noteA.id)).toBeDefined();
    expect(v2.store.getById(noteB.id)).toBeDefined();

    v2.destroy();
  });

  it('preserves layers and active layer through roundtrip', () => {
    const v1 = new Viewport(container);
    const layer2 = v1.layerManager.createLayer('Background');
    const layer3 = v1.layerManager.createLayer('Foreground');

    const noteOnDefault = createNote({
      position: { x: 0, y: 0 },
      layerId: v1.layerManager.activeLayerId,
    });
    const noteOnL2 = createNote({
      position: { x: 100, y: 100 },
      layerId: layer2.id,
    });
    const noteOnL3 = createNote({
      position: { x: 200, y: 200 },
      layerId: layer3.id,
    });

    v1.store.add(noteOnDefault);
    v1.store.add(noteOnL2);
    v1.store.add(noteOnL3);
    v1.layerManager.setActiveLayer(layer2.id);

    const state = v1.exportState();
    v1.destroy();

    const v2 = new Viewport(container);
    v2.loadState(state);

    expect(v2.layerManager.layers).toHaveLength(3);
    expect(v2.layerManager.activeLayerId).toBe(layer2.id);

    const rDefault = v2.store.getById(noteOnDefault.id);
    const rL2 = v2.store.getById(noteOnL2.id);
    const rL3 = v2.store.getById(noteOnL3.id);

    expect(rDefault?.layerId).toBe(noteOnDefault.layerId);
    expect(rL2?.layerId).toBe(layer2.id);
    expect(rL3?.layerId).toBe(layer3.id);

    v2.destroy();
  });

  it('preserves grid element properties through roundtrip', () => {
    const v1 = new Viewport(container);

    v1.addGrid({
      gridType: 'hex',
      hexOrientation: 'flat',
      cellSize: 60,
      strokeColor: '#aabbcc',
      strokeWidth: 2,
      opacity: 0.8,
    });

    const state = v1.exportState();
    const gridId = v1.store.getElementsByType('grid')[0]?.id;
    v1.destroy();

    const v2 = new Viewport(container);
    v2.loadState(state);

    expect(gridId).toBeDefined();
    const rGrid = v2.store.getById(gridId ?? '') as GridElement;
    expect(rGrid).toBeDefined();
    expect(rGrid.type).toBe('grid');
    expect(rGrid.gridType).toBe('hex');
    expect(rGrid.hexOrientation).toBe('flat');
    expect(rGrid.cellSize).toBe(60);
    expect(rGrid.strokeColor).toBe('#aabbcc');
    expect(rGrid.strokeWidth).toBe(2);
    expect(rGrid.opacity).toBe(0.8);

    v2.destroy();
  });

  it('clears history after loading state', () => {
    const v1 = new Viewport(container);
    v1.store.add(createNote({ position: { x: 0, y: 0 }, layerId: v1.layerManager.activeLayerId }));
    const state = v1.exportState();
    v1.destroy();

    const v2 = new Viewport(container);
    v2.loadState(state);
    expect(v2.undo()).toBe(false);

    v2.destroy();
  });

  it('roundtrips through JSON serialization', () => {
    const v1 = new Viewport(container);
    const layerId = v1.layerManager.activeLayerId;

    const note = createNote({
      position: { x: 50, y: 60 },
      size: { w: 100, h: 80 },
      text: 'JSON test',
      layerId,
    });
    v1.store.add(note);
    v1.camera.moveTo(42, 99);
    v1.camera.setZoom(2.0);

    const json = v1.exportJSON();
    v1.destroy();

    const v2 = new Viewport(container);
    v2.loadJSON(json);

    expect(v2.store.count).toBe(1);
    const rNote = v2.store.getById(note.id) as NoteElement;
    expect(rNote.text).toBe('JSON test');
    expect(v2.camera.position.x).toBe(42);
    expect(v2.camera.zoom).toBe(2.0);

    v2.destroy();
  });
});
