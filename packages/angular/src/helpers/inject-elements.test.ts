import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { createNote, createShape } from '@fieldnotes/core';
import type { CanvasElement, ElementType, NoteElement, ShapeElement } from '@fieldnotes/core';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { mountHelper } from '../test-utils/mount-helper';
import { injectElements } from './inject-elements';

afterEach(destroyTestViewports);

const selectLength = (els: CanvasElement[]) => els.length;
const selectXs = (els: CanvasElement[]) => els.map((e) => e.position.x);
const sameLength = (a: number[], b: number[]) => a.length === b.length;
const shapeSize = { w: 10, h: 10 };

describe('injectElements', () => {
  it('holds [] or selector([]) before a viewport exists', async () => {
    const { result } = await mountHelper(
      () => [injectElements(), injectElements('note'), injectElements(() => 'empty')] as const,
      null,
    );
    expect(result.map((s) => s())).toEqual([[], [], 'empty']);
  });

  it('tracks added, updated and removed elements', async () => {
    const viewport = createTestViewport();
    const { result } = await mountHelper(() => injectElements(), viewport);
    expect(result()).toEqual([]);
    const note = createNote({ position: { x: 0, y: 0 } });
    viewport.store.add(note);
    expect(result().map((e) => e.id)).toEqual([note.id]);
    viewport.store.update(note.id, { position: { x: 50, y: 50 } });
    expect(result()[0]?.position).toEqual({ x: 50, y: 50 });
    viewport.store.remove(note.id);
    expect(result()).toEqual([]);
  });

  it('filters by type with a narrowed element type', async () => {
    const viewport = createTestViewport();
    const { result } = await mountHelper(() => injectElements('note'), viewport);
    expectTypeOf(result).toEqualTypeOf<Signal<NoteElement[]>>();
    viewport.store.add(createNote({ position: { x: 0, y: 0 } }));
    viewport.store.add(createShape({ position: { x: 0, y: 0 }, size: shapeSize }));
    expect(result().map((e) => e.type)).toEqual(['note']);
  });

  it('keeps the same array when a store change leaves the filtered set unchanged', async () => {
    const viewport = createTestViewport();
    const { result } = await mountHelper(() => injectElements('note'), viewport);
    viewport.store.add(createNote({ position: { x: 0, y: 0 } }));
    const before = result();
    viewport.store.add(createShape({ position: { x: 0, y: 0 }, size: shapeSize }));
    expect(result()).toBe(before);
  });

  it('follows a type signal', async () => {
    const viewport = createTestViewport();
    const type = signal<ElementType | undefined>('note');
    const { result, fixture } = await mountHelper(() => injectElements(type), viewport);
    viewport.store.add(createNote({ position: { x: 0, y: 0 } }));
    viewport.store.add(createShape({ position: { x: 0, y: 0 }, size: shapeSize }));
    expect(result().map((e) => e.type)).toEqual(['note']);

    type.set('shape');
    await fixture.whenStable();
    expect(result().map((e) => e.type)).toEqual(['shape']);

    type.set(undefined);
    await fixture.whenStable();
    expect(result().map((e) => e.type)).toEqual(['note', 'shape']);
  });

  it('narrows a Signal<ElementType> argument and does not treat it as a selector', async () => {
    const type = signal<'shape'>('shape');
    const { result } = await mountHelper(() => injectElements(type), null);
    expectTypeOf(result).toEqualTypeOf<Signal<ShapeElement[]>>();
    expect(result()).toEqual([]);
  });

  it('selector returns the selected value', async () => {
    const viewport = createTestViewport();
    const { result } = await mountHelper(() => injectElements(selectLength), viewport);
    expectTypeOf(result).toEqualTypeOf<Signal<number>>();
    expect(result()).toBe(0);
    viewport.store.add(createNote({ position: { x: 0, y: 0 } }));
    expect(result()).toBe(1);
  });

  it('selector keeps the same reference when the selected value is shallow-equal', async () => {
    const viewport = createTestViewport();
    const { result } = await mountHelper(() => injectElements(selectXs), viewport);
    const note = createNote({ position: { x: 5, y: 0 } });
    viewport.store.add(note);
    const before = result();
    viewport.store.update(note.id, { position: { x: 5, y: 50 } });
    expect(result()).toBe(before);
    viewport.store.update(note.id, { position: { x: 9, y: 50 } });
    expect(result()).toEqual([9]);
  });

  it('respects a custom isEqual', async () => {
    const viewport = createTestViewport();
    const { result } = await mountHelper(() => injectElements(selectXs, sameLength), viewport);
    const note = createNote({ position: { x: 0, y: 0 } });
    viewport.store.add(note);
    viewport.store.update(note.id, { position: { x: 99, y: 0 } });
    expect(result()).toEqual([0]);
  });
});
