import { describe, it, expect } from 'vitest';
import { InsertQueue } from './insert-queue';
import { ElementStore } from '../elements/element-store';
import { HistoryStack } from '../history/history-stack';
import { HistoryRecorder } from '../history/history-recorder';
import { createShape } from '../elements/element-factory';

function setup() {
  const store = new ElementStore();
  const stack = new HistoryStack();
  const recorder = new HistoryRecorder(store, stack);
  const state = { gesture: false, flushes: 0 };
  const queue = new InsertQueue({
    recorder,
    isGestureActive: () => state.gesture,
    flushPendingHistory: () => {
      state.flushes += 1;
    },
    transaction: (run) => recorder.run(run),
  });
  const shape = () =>
    createShape({ shape: 'rectangle', position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
  return { store, stack, recorder, state, queue, shape };
}

describe('InsertQueue', () => {
  it('runs now when idle in its own transaction', () => {
    const { store, stack, state, queue, shape } = setup();

    queue.insertWhenIdle(() => store.add(shape()));

    expect(store.count).toBe(1);
    expect(stack.undoCount).toBe(1);
    expect(state.flushes).toBe(1);
  });

  it('queues behind an open transaction and runs after commit as a separate step', async () => {
    const { store, stack, recorder, queue, shape } = setup();
    recorder.begin();
    store.add(shape());

    queue.insertWhenIdle(() => store.add(shape()));
    expect(store.count).toBe(1);
    recorder.commit();
    await Promise.resolve();

    expect(store.count).toBe(2);
    expect(stack.undoCount).toBe(2);
    stack.undo(store);
    expect(store.count).toBe(1);
  });

  it('queues while a gesture is active and drains on the next transaction end', async () => {
    const { store, recorder, state, queue, shape } = setup();
    state.gesture = true;

    queue.insertWhenIdle(() => store.add(shape()));
    expect(store.count).toBe(0);
    state.gesture = false;
    recorder.run(() => undefined);
    await Promise.resolve();

    expect(store.count).toBe(1);
  });

  it('drains FIFO and stops at the first item that cannot run', async () => {
    const { recorder, state, queue } = setup();
    const ran: string[] = [];
    recorder.begin();
    queue.insertWhenIdle(() => {
      ran.push('first');
      state.gesture = true;
    });
    queue.insertWhenIdle(() => ran.push('second'));

    recorder.commit();
    await Promise.resolve();
    await Promise.resolve();
    expect(ran).toEqual(['first']);

    state.gesture = false;
    recorder.run(() => undefined);
    await Promise.resolve();
    expect(ran).toEqual(['first', 'second']);
  });

  it('destroy clears the queue and ignores later inserts', async () => {
    const { store, recorder, queue, shape } = setup();
    recorder.begin();
    queue.insertWhenIdle(() => store.add(shape()));

    queue.destroy();
    recorder.commit();
    await Promise.resolve();
    queue.insertWhenIdle(() => store.add(shape()));

    expect(store.count).toBe(0);
  });
});
