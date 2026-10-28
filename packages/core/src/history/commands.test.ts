import { describe, it, expect } from 'vitest';
import {
  AddElementCommand,
  RemoveElementCommand,
  UpdateElementCommand,
  UpdateElementsCommand,
  BatchCommand,
} from './commands';
import { ElementStore } from '../elements/element-store';
import { createNote, createStroke } from '../elements/element-factory';
import { createFrame } from '../elements/frame-element';

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

  it('undo clears a key that the update newly added', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const updated = { ...note, groupId: 'g1' };
    const cmd = new UpdateElementCommand(note.id, note, updated);

    cmd.execute(store);
    expect(store.getById(note.id)?.groupId).toBe('g1');

    cmd.undo(store);
    expect(store.getById(note.id)?.groupId).toBeUndefined();
  });
});

describe('UpdateElementsCommand', () => {
  it('replays a parent and child layer move atomically in input order', () => {
    const store = new ElementStore();
    const parent = { ...createNote({ position: { x: 0, y: 0 }, layerId: 'a' }), id: 'parent' };
    const child = {
      ...createNote({ position: { x: 10, y: 0 }, layerId: 'a', parentId: 'parent' }),
      id: 'child',
    };
    store.add(parent);
    store.add(child);
    const command = new UpdateElementsCommand([
      { previous: parent, current: { ...parent, layerId: 'b', groupId: 'g1' } },
      { previous: child, current: { ...child, layerId: 'b' } },
    ]);
    const events: string[] = [];
    store.on('update', ({ current }) => events.push(current.id));

    command.execute(store);
    expect(events).toEqual(['parent', 'child']);
    expect(store.getById('child')).toMatchObject({ layerId: 'b', parentId: 'parent' });

    command.undo(store);
    expect(events).toEqual(['parent', 'child', 'parent', 'child']);
    expect(store.getById('parent')?.groupId).toBeUndefined();
    expect(store.getById('child')).toMatchObject({ layerId: 'a', parentId: 'parent' });
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
    const newEl = createStroke({ points: [{ x: 0, y: 0, pressure: 0.5 }] });
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

  it('restores a frame before restoring detached child links', () => {
    const store = new ElementStore();
    const parent = {
      ...createFrame({ position: { x: 0, y: 0 }, size: { w: 120, h: 90 }, index: 'a0' }),
      id: 'parent',
    };
    const first = {
      ...createNote({ position: { x: 10, y: 30 }, parentId: parent.id, index: 'a1' }),
      id: 'first',
    };
    const second = {
      ...createNote({ position: { x: 20, y: 40 }, parentId: parent.id, index: 'a2' }),
      id: 'second',
    };
    store.add(parent);
    store.add(first);
    store.add(second);

    const detach = new UpdateElementsCommand([
      { previous: first, current: { ...first, parentId: undefined } },
      { previous: second, current: { ...second, parentId: undefined } },
    ]);
    const batch = new BatchCommand([detach, new RemoveElementCommand(parent)]);

    batch.execute(store);
    expect(store.getById(parent.id)).toBeUndefined();
    expect(store.getById(first.id)?.parentId).toBeUndefined();
    expect(store.getById(second.id)?.parentId).toBeUndefined();

    batch.undo(store);
    expect(store.getById(parent.id)).toBeDefined();
    expect(store.getById(first.id)?.parentId).toBe(parent.id);
    expect(store.getById(second.id)?.parentId).toBe(parent.id);
  });
});
