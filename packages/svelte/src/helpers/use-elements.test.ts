import { describe, it, expect, expectTypeOf, afterEach } from 'vitest';
import type { Readable } from 'svelte/store';
import { createNote, createShape } from '@fieldnotes/core';
import type { CanvasElement, NoteElement } from '@fieldnotes/core';
import { useElements } from './use-elements.svelte.js';
import { mountHelper, record } from '../test-fixtures/mount-helper';
import { destroyTestViewports } from '../test-fixtures/create-test-viewport';

afterEach(destroyTestViewports);

const selectLength = (els: CanvasElement[]) => els.length;
const selectXs = (els: CanvasElement[]) => els.map((e) => e.position.x);
const sameLength = (a: number[], b: number[]) => a.length === b.length;

describe('useElements', () => {
  it('tracks added, updated and removed elements', () => {
    const { result, viewport } = mountHelper(() => useElements());
    const values = record(result);
    expect(values.at(-1)).toEqual([]);
    const note = createNote({ position: { x: 0, y: 0 } });
    viewport.store.add(note);
    expect(values.at(-1)?.map((e) => e.id)).toEqual([note.id]);
    viewport.store.update(note.id, { position: { x: 50, y: 50 } });
    expect(values.at(-1)?.[0]?.position).toEqual({ x: 50, y: 50 });
    viewport.store.remove(note.id);
    expect(values.at(-1)).toEqual([]);
  });

  it('filters by type with a narrowed element type', () => {
    const { result, viewport } = mountHelper(() => useElements('note'));
    expectTypeOf(result).toEqualTypeOf<Readable<NoteElement[]>>();
    const values = record(result);
    viewport.store.add(createNote({ position: { x: 0, y: 0 } }));
    viewport.store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }));
    expect(values.at(-1)?.map((e) => e.type)).toEqual(['note']);
  });

  it('does not notify when a store change leaves the filtered set unchanged', () => {
    const { result, viewport } = mountHelper(() => useElements('note'));
    const values = record(result);
    viewport.store.add(createNote({ position: { x: 0, y: 0 } }));
    viewport.store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }));
    expect(values).toHaveLength(2);
  });

  it('selector returns the selected value', () => {
    const { result, viewport } = mountHelper(() => useElements(selectLength));
    const values = record(result);
    viewport.store.add(createNote({ position: { x: 0, y: 0 } }));
    expect(values).toEqual([0, 1]);
  });

  it('selector does not notify when the selected value is shallow-equal', () => {
    const { result, viewport } = mountHelper(() => useElements(selectXs));
    const note = createNote({ position: { x: 5, y: 0 } });
    viewport.store.add(note);
    const values = record(result);
    viewport.store.update(note.id, { position: { x: 5, y: 50 } });
    expect(values).toEqual([[5]]);
    viewport.store.update(note.id, { position: { x: 9, y: 50 } });
    expect(values).toEqual([[5], [9]]);
  });

  it('respects a custom isEqual', () => {
    const { result, viewport } = mountHelper(() => useElements(selectXs, sameLength));
    const values = record(result);
    const note = createNote({ position: { x: 0, y: 0 } });
    viewport.store.add(note);
    viewport.store.update(note.id, { position: { x: 99, y: 0 } });
    expect(values.at(-1)).toEqual([0]);
  });
});
