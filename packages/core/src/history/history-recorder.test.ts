import { describe, it, expect } from 'vitest';
import { HistoryRecorder } from './history-recorder';
import { HistoryStack } from './history-stack';
import { ElementStore } from '../elements/element-store';
import { createNote } from '../elements/element-factory';
import { LayerManager } from '../layers/layer-manager';

function setup() {
  const store = new ElementStore();
  const stack = new HistoryStack();
  const recorder = new HistoryRecorder(store, stack);
  return { store, stack, recorder };
}

describe('HistoryRecorder', () => {
  it('records add operations', () => {
    const { store, stack } = setup();
    const note = createNote({ position: { x: 0, y: 0 } });

    store.add(note);

    expect(stack.undoCount).toBe(1);
    stack.undo(store);
    expect(store.count).toBe(0);
  });

  it('records remove operations', () => {
    const { store, stack } = setup();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    store.remove(note.id);

    expect(stack.undoCount).toBe(2);
    stack.undo(store);
    expect(store.count).toBe(1);
  });

  it('records update operations', () => {
    const { store, stack } = setup();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    store.update(note.id, { position: { x: 50, y: 50 } });

    expect(stack.undoCount).toBe(2);
    stack.undo(store);
    expect(store.getById(note.id)?.position).toEqual({ x: 0, y: 0 });
  });

  it('does not record when paused', () => {
    const { store, stack, recorder } = setup();
    recorder.pause();

    store.add(createNote({ position: { x: 0, y: 0 } }));

    expect(stack.undoCount).toBe(0);
    recorder.resume();
  });

  it('batches operations in a transaction', () => {
    const { store, stack, recorder } = setup();
    const n1 = createNote({ position: { x: 0, y: 0 } });
    const n2 = createNote({ position: { x: 100, y: 100 } });

    recorder.begin();
    store.add(n1);
    store.add(n2);
    recorder.commit();

    expect(stack.undoCount).toBe(1);
    stack.undo(store);
    expect(store.count).toBe(0);
  });

  it('merges updates within a transaction', () => {
    const { store, stack, recorder } = setup();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);

    recorder.begin();
    store.update(note.id, { position: { x: 10, y: 10 } });
    store.update(note.id, { position: { x: 20, y: 20 } });
    store.update(note.id, { position: { x: 30, y: 30 } });
    recorder.commit();

    expect(stack.undoCount).toBe(2);
    stack.undo(store);
    expect(store.getById(note.id)?.position).toEqual({ x: 0, y: 0 });
  });

  it('does not record during undo', () => {
    const { store, stack, recorder } = setup();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);

    recorder.pause();
    stack.undo(store);
    recorder.resume();

    expect(stack.undoCount).toBe(0);
    expect(stack.canRedo).toBe(true);
  });

  it('rollback discards transaction', () => {
    const { store, stack, recorder } = setup();
    const note = createNote({ position: { x: 0, y: 0 } });

    recorder.begin();
    store.add(note);
    recorder.rollback();

    expect(stack.undoCount).toBe(0);
  });

  it('empty transaction does not push to stack', () => {
    const { stack, recorder } = setup();

    recorder.begin();
    recorder.commit();

    expect(stack.undoCount).toBe(0);
  });

  it('handles add + multiple updates in one transaction', () => {
    const { store, stack, recorder } = setup();
    const note = createNote({ position: { x: 0, y: 0 } });

    recorder.begin();
    store.add(note);
    store.update(note.id, { position: { x: 10, y: 10 } });
    store.update(note.id, { position: { x: 20, y: 20 } });
    recorder.commit();

    expect(stack.undoCount).toBe(1);
    stack.undo(store);
    expect(store.count).toBe(0);
  });

  it('destroy unsubscribes from store events', () => {
    const { store, stack, recorder } = setup();
    recorder.destroy();

    store.add(createNote({ position: { x: 0, y: 0 } }));

    expect(stack.undoCount).toBe(0);
  });

  describe('layer undo', () => {
    function setupWithLayers() {
      const store = new ElementStore();
      const stack = new HistoryStack();
      const layerManager = new LayerManager(store);
      const recorder = new HistoryRecorder(store, stack, layerManager);
      return { store, stack, layerManager, recorder };
    }

    it('records layer creation and undoes it', () => {
      const { stack, layerManager, store } = setupWithLayers();
      const layer = layerManager.createLayer('New');
      expect(layerManager.getLayers()).toHaveLength(2);
      expect(stack.undoCount).toBe(1);

      stack.undo(store);
      expect(layerManager.getLayers()).toHaveLength(1);
      expect(layerManager.getLayer(layer.id)).toBeUndefined();
    });

    it('records layer removal and undoes it', () => {
      const { stack, layerManager, store } = setupWithLayers();
      const layer = layerManager.createLayer('ToRemove');
      layerManager.removeLayer(layer.id);
      expect(layerManager.getLayers()).toHaveLength(1);

      stack.undo(store);
      expect(layerManager.getLayers()).toHaveLength(2);
      expect(layerManager.getLayer(layer.id)).toBeDefined();
    });

    it('records layer rename and undoes it', () => {
      const { stack, layerManager, store } = setupWithLayers();
      const id = layerManager.activeLayerId;
      layerManager.renameLayer(id, 'Renamed');
      expect(layerManager.getLayer(id)?.name).toBe('Renamed');

      stack.undo(store);
      expect(layerManager.getLayer(id)?.name).toBe('Layer 1');
    });

    it('records layer visibility change and undoes it', () => {
      const { stack, layerManager, store } = setupWithLayers();
      layerManager.createLayer();
      const id = layerManager.getLayers()[0]?.id;
      if (!id) throw new Error('Expected a layer');
      layerManager.setLayerVisible(id, false);
      expect(layerManager.isLayerVisible(id)).toBe(false);

      stack.undo(store);
      expect(layerManager.isLayerVisible(id)).toBe(true);
    });

    it('records layer opacity change and undoes it', () => {
      const { stack, layerManager, store } = setupWithLayers();
      const id = layerManager.activeLayerId;
      layerManager.setLayerOpacity(id, 0.3);

      stack.undo(store);
      expect(layerManager.getLayer(id)?.opacity).toBe(1.0);
    });

    it('does not record when paused', () => {
      const { stack, layerManager, recorder } = setupWithLayers();
      recorder.pause();
      layerManager.createLayer('Ignored');
      expect(stack.undoCount).toBe(0);
      recorder.resume();
    });

    it('batches layer operations in a transaction', () => {
      const { stack, layerManager, recorder, store } = setupWithLayers();
      recorder.begin();
      layerManager.createLayer('A');
      layerManager.createLayer('B');
      recorder.commit();

      expect(stack.undoCount).toBe(1);
      stack.undo(store);
      expect(layerManager.getLayers()).toHaveLength(1);
    });

    it('batches element + layer operations in a transaction', () => {
      const { store, stack, layerManager, recorder } = setupWithLayers();
      recorder.begin();
      const layer = layerManager.createLayer('New');
      store.add(createNote({ position: { x: 0, y: 0 }, layerId: layer.id }));
      recorder.commit();

      expect(stack.undoCount).toBe(1);
      stack.undo(store);
      expect(layerManager.getLayers()).toHaveLength(1);
      expect(store.count).toBe(0);
    });

    it('does not record layer events during loadSnapshot', () => {
      const { layerManager } = setupWithLayers();
      layerManager.createLayer('Extra');
      const snap = layerManager.snapshot();

      const store2 = new ElementStore();
      const stack2 = new HistoryStack();
      const lm2 = new LayerManager(store2);
      new HistoryRecorder(store2, stack2, lm2);

      lm2.loadSnapshot(snap);
      expect(stack2.undoCount).toBe(0);
    });

    it('destroy unsubscribes from layer events', () => {
      const { stack, layerManager, recorder } = setupWithLayers();
      recorder.destroy();
      layerManager.createLayer('AfterDestroy');
      expect(stack.undoCount).toBe(0);
    });
  });
});
