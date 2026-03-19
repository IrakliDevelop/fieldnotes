import { describe, it, expect } from 'vitest';
import { HistoryRecorder } from './history-recorder';
import { HistoryStack } from './history-stack';
import { ElementStore } from '../elements/element-store';
import { createNote } from '../elements/element-factory';

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
});
