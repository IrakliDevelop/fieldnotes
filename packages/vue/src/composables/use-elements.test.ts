import { describe, it, expect, expectTypeOf, afterEach } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { createNote, createShape } from '@fieldnotes/core';
import type { CanvasElement, ElementType, NoteElement } from '@fieldnotes/core';
import { useElements } from './use-elements';
import { mountComposable } from '../test-utils/mount-composable';
import { destroyTestViewports } from '../test-utils/create-test-viewport';

enableAutoUnmount(afterEach);
afterEach(destroyTestViewports);

const selectLength = (els: CanvasElement[]) => els.length;
const selectXs = (els: CanvasElement[]) => els.map((e) => e.position.x);
const sameLength = (a: number[], b: number[]) => a.length === b.length;

describe('useElements', () => {
  it('tracks added, updated and removed elements', () => {
    const { result, viewport } = mountComposable(() => useElements());
    expect(result.value).toEqual([]);
    const note = createNote({ position: { x: 0, y: 0 } });
    viewport.store.add(note);
    expect(result.value.map((e) => e.id)).toEqual([note.id]);
    viewport.store.update(note.id, { position: { x: 50, y: 50 } });
    expect(result.value[0]?.position).toEqual({ x: 50, y: 50 });
    viewport.store.remove(note.id);
    expect(result.value).toEqual([]);
  });

  it('filters by type with a narrowed element type', () => {
    const { result, viewport } = mountComposable(() => useElements('note'));
    expectTypeOf(result.value).toEqualTypeOf<NoteElement[]>();
    viewport.store.add(createNote({ position: { x: 0, y: 0 } }));
    viewport.store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }));
    expect(result.value.map((e) => e.type)).toEqual(['note']);
  });

  it('keeps the same array when a store change leaves the filtered set unchanged', () => {
    const { result, viewport } = mountComposable(() => useElements('note'));
    viewport.store.add(createNote({ position: { x: 0, y: 0 } }));
    const before = result.value;
    viewport.store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }));
    expect(result.value).toBe(before);
  });

  it('follows a type ref', async () => {
    const type = ref<ElementType | undefined>('note');
    const { result, viewport } = mountComposable(() => useElements(type));
    viewport.store.add(createNote({ position: { x: 0, y: 0 } }));
    viewport.store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }));
    expect(result.value.map((e) => e.type)).toEqual(['note']);

    type.value = 'shape';
    await nextTick();
    expect(result.value.map((e) => e.type)).toEqual(['shape']);

    type.value = undefined;
    await nextTick();
    expect(result.value.map((e) => e.type)).toEqual(['note', 'shape']);
  });

  it('selector returns the selected value', () => {
    const { result, viewport } = mountComposable(() => useElements(selectLength));
    expect(result.value).toBe(0);
    viewport.store.add(createNote({ position: { x: 0, y: 0 } }));
    expect(result.value).toBe(1);
  });

  it('selector keeps the same reference when the selected value is shallow-equal', () => {
    const { result, viewport } = mountComposable(() => useElements(selectXs));
    const note = createNote({ position: { x: 5, y: 0 } });
    viewport.store.add(note);
    const before = result.value;
    viewport.store.update(note.id, { position: { x: 5, y: 50 } });
    expect(result.value).toBe(before);
    viewport.store.update(note.id, { position: { x: 9, y: 50 } });
    expect(result.value).toEqual([9]);
  });

  it('respects a custom isEqual', () => {
    const { result, viewport } = mountComposable(() => useElements(selectXs, sameLength));
    const note = createNote({ position: { x: 0, y: 0 } });
    viewport.store.add(note);
    viewport.store.update(note.id, { position: { x: 99, y: 0 } });
    expect(result.value).toEqual([0]);
  });
});
