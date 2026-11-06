import { describe, it, expect, vi } from 'vitest';
import { HistoryStack } from './history-stack';
import { AddElementCommand } from './commands';
import { ElementStore } from '../elements/element-store';
import { createNote, createShape } from '../elements/element-factory';
import { createBoundText } from '../elements/bound-text';
import { setTextMeasurer } from '../elements/text-measure';

describe('HistoryStack', () => {
  it('starts empty', () => {
    const stack = new HistoryStack();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
    expect(stack.undoCount).toBe(0);
    expect(stack.redoCount).toBe(0);
  });

  it('can undo a pushed command', () => {
    const stack = new HistoryStack();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    const cmd = new AddElementCommand(note);

    cmd.execute(store);
    stack.push(cmd);

    expect(stack.canUndo).toBe(true);
    stack.undo(store);
    expect(store.count).toBe(0);
  });

  it('can redo after undo', () => {
    const stack = new HistoryStack();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    const cmd = new AddElementCommand(note);

    cmd.execute(store);
    stack.push(cmd);
    stack.undo(store);

    expect(stack.canRedo).toBe(true);
    stack.redo(store);
    expect(store.count).toBe(1);
  });

  it('clears redo stack on new push', () => {
    const stack = new HistoryStack();
    const store = new ElementStore();
    const n1 = createNote({ position: { x: 0, y: 0 } });
    const n2 = createNote({ position: { x: 100, y: 100 } });

    const cmd1 = new AddElementCommand(n1);
    cmd1.execute(store);
    stack.push(cmd1);
    stack.undo(store);

    const cmd2 = new AddElementCommand(n2);
    cmd2.execute(store);
    stack.push(cmd2);

    expect(stack.canRedo).toBe(false);
  });

  it('respects maxSize', () => {
    const stack = new HistoryStack({ maxSize: 3 });
    const store = new ElementStore();

    for (let i = 0; i < 5; i++) {
      const note = createNote({ position: { x: i, y: i } });
      const cmd = new AddElementCommand(note);
      cmd.execute(store);
      stack.push(cmd);
    }

    expect(stack.undoCount).toBe(3);
  });

  it('returns false when undo on empty stack', () => {
    const stack = new HistoryStack();
    const store = new ElementStore();
    expect(stack.undo(store)).toBe(false);
  });

  it('returns false when redo on empty stack', () => {
    const stack = new HistoryStack();
    const store = new ElementStore();
    expect(stack.redo(store)).toBe(false);
  });

  it('clear empties both stacks', () => {
    const stack = new HistoryStack();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    const cmd = new AddElementCommand(note);

    cmd.execute(store);
    stack.push(cmd);
    stack.undo(store);

    stack.clear();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
  });

  it('notifies listeners on changes', () => {
    const stack = new HistoryStack();
    const store = new ElementStore();
    const listener = vi.fn();
    stack.onChange(listener);

    const note = createNote({ position: { x: 0, y: 0 } });
    const cmd = new AddElementCommand(note);
    cmd.execute(store);
    stack.push(cmd);

    expect(listener).toHaveBeenCalledTimes(1);

    stack.undo(store);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes listener', () => {
    const stack = new HistoryStack();
    const store = new ElementStore();
    const listener = vi.fn();
    const unsub = stack.onChange(listener);

    unsub();
    const note = createNote({ position: { x: 0, y: 0 } });
    const cmd = new AddElementCommand(note);
    cmd.execute(store);
    stack.push(cmd);

    expect(listener).not.toHaveBeenCalled();
  });

  it('multiple undo/redo cycles work correctly', () => {
    const stack = new HistoryStack();
    const store = new ElementStore();
    const n1 = createNote({ position: { x: 0, y: 0 } });
    const n2 = createNote({ position: { x: 100, y: 100 } });

    const cmd1 = new AddElementCommand(n1);
    cmd1.execute(store);
    stack.push(cmd1);

    const cmd2 = new AddElementCommand(n2);
    cmd2.execute(store);
    stack.push(cmd2);

    expect(store.count).toBe(2);

    stack.undo(store);
    expect(store.count).toBe(1);

    stack.undo(store);
    expect(store.count).toBe(0);

    stack.redo(store);
    expect(store.count).toBe(1);

    stack.redo(store);
    expect(store.count).toBe(2);
  });

  it('keeps bound-text derivation suppressed through nested replay', () => {
    setTextMeasurer(() => 100);
    try {
      const stack = new HistoryStack();
      const inner = new HistoryStack();
      const store = new ElementStore();
      const host = createShape({
        shape: 'rectangle',
        position: { x: 0, y: 0 },
        size: { w: 100, h: 30 },
      });
      const child = createBoundText(host, { text: 'one two three' });
      const note = createNote({ position: { x: 0, y: 0 } });
      store.add(host);
      store.add(note);
      inner.push(new AddElementCommand(note));
      stack.push({
        execute: () => undefined,
        undo: () => {
          inner.undo(store);
          store.add(child);
        },
      });

      expect(stack.undo(store)).toBe(true);
      const restoredHost = store.getById(host.id);
      expect(restoredHost?.type === 'shape' ? restoredHost.size : undefined).toEqual({
        w: 100,
        h: 30,
      });
      store.update(child.id, { text: 'four five six' });
      const resizedHost = store.getById(host.id);
      expect(resizedHost?.type === 'shape' ? resizedHost.size.h : undefined).toBeGreaterThan(30);
    } finally {
      setTextMeasurer(null);
    }
  });

  it('clears bound-text replay suppression when a command throws', () => {
    setTextMeasurer(() => 100);
    try {
      const stack = new HistoryStack();
      const store = new ElementStore();
      const host = createShape({
        shape: 'rectangle',
        position: { x: 0, y: 0 },
        size: { w: 100, h: 30 },
      });
      store.add(host);
      stack.push({
        execute: () => undefined,
        undo: () => {
          throw new Error('failed replay');
        },
      });

      expect(() => stack.undo(store)).toThrow('failed replay');
      store.add(createBoundText(host, { text: 'one two three' }));
      const resizedHost = store.getById(host.id);
      expect(resizedHost?.type === 'shape' ? resizedHost.size.h : undefined).toBeGreaterThan(30);
    } finally {
      setTextMeasurer(null);
    }
  });
});
