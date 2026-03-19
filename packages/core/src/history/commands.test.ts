import { describe, it, expect } from 'vitest';
import {
  AddElementCommand,
  RemoveElementCommand,
  UpdateElementCommand,
  BatchCommand,
} from './commands';
import { ElementStore } from '../elements/element-store';
import { createNote, createStroke } from '../elements/element-factory';

describe('AddElementCommand', () => {
  it('adds element on execute', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    const cmd = new AddElementCommand(note);

    cmd.execute(store);

    expect(store.count).toBe(1);
    expect(store.getById(note.id)).toBeDefined();
  });

  it('removes element on undo', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    const cmd = new AddElementCommand(note);

    cmd.execute(store);
    cmd.undo(store);

    expect(store.count).toBe(0);
  });
});

describe('RemoveElementCommand', () => {
  it('removes element on execute', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const cmd = new RemoveElementCommand(note);

    cmd.execute(store);

    expect(store.count).toBe(0);
  });

  it('restores element on undo', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const cmd = new RemoveElementCommand(note);

    cmd.execute(store);
    cmd.undo(store);

    expect(store.count).toBe(1);
    expect(store.getById(note.id)).toBeDefined();
  });
});

describe('UpdateElementCommand', () => {
  it('applies new state on execute', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const updated = { ...note, position: { x: 50, y: 50 } };
    const cmd = new UpdateElementCommand(note.id, note, updated);

    cmd.execute(store);

    expect(store.getById(note.id)?.position).toEqual({ x: 50, y: 50 });
  });

  it('restores previous state on undo', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const updated = { ...note, position: { x: 50, y: 50 } };
    const cmd = new UpdateElementCommand(note.id, note, updated);

    cmd.execute(store);
    cmd.undo(store);

    expect(store.getById(note.id)?.position).toEqual({ x: 0, y: 0 });
  });
});

describe('BatchCommand', () => {
  it('executes all commands in order', () => {
    const store = new ElementStore();
    const n1 = createNote({ position: { x: 0, y: 0 } });
    const n2 = createNote({ position: { x: 100, y: 100 } });
    const batch = new BatchCommand([new AddElementCommand(n1), new AddElementCommand(n2)]);

    batch.execute(store);

    expect(store.count).toBe(2);
  });

  it('undoes all commands in reverse order', () => {
    const store = new ElementStore();
    const n1 = createNote({ position: { x: 0, y: 0 } });
    const n2 = createNote({ position: { x: 100, y: 100 } });
    const batch = new BatchCommand([new AddElementCommand(n1), new AddElementCommand(n2)]);

    batch.execute(store);
    batch.undo(store);

    expect(store.count).toBe(0);
  });

  it('handles mixed add and remove commands', () => {
    const store = new ElementStore();
    const existing = createNote({ position: { x: 0, y: 0 } });
    store.add(existing);
    const newEl = createStroke({ points: [{ x: 0, y: 0 }] });
    const batch = new BatchCommand([
      new RemoveElementCommand(existing),
      new AddElementCommand(newEl),
    ]);

    batch.execute(store);
    expect(store.count).toBe(1);
    expect(store.getById(newEl.id)).toBeDefined();

    batch.undo(store);
    expect(store.count).toBe(1);
    expect(store.getById(existing.id)).toBeDefined();
  });
});
