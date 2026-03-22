// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { NoteEditor } from './note-editor';
import { ElementStore } from './element-store';
import { createNote } from './element-factory';

function makeNode(text = ''): HTMLDivElement {
  const node = document.createElement('div');
  node.textContent = text;
  return node;
}

function flushRAF(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe('NoteEditor', () => {
  it('starts in non-editing state', () => {
    const editor = new NoteEditor();
    expect(editor.isEditing).toBe(false);
    expect(editor.editingElementId).toBeNull();
  });

  it('enters editing mode after rAF', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, text: 'hello' });
    store.add(note);
    const node = makeNode('hello');

    editor.startEditing(node, note.id, store);
    expect(editor.isEditing).toBe(false);

    await flushRAF();

    expect(editor.isEditing).toBe(true);
    expect(editor.editingElementId).toBe(note.id);
    expect(node.contentEditable).toBe('true');
  });

  it('saves text on stopEditing', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, text: 'old' });
    store.add(note);
    const node = makeNode('old');

    editor.startEditing(node, note.id, store);
    await flushRAF();

    node.textContent = 'new text';
    editor.stopEditing(store);

    expect(editor.isEditing).toBe(false);
    const updated = store.getById(note.id);
    expect(updated && 'text' in updated ? updated.text : '').toBe('new text');
  });

  it('makes node non-editable after stopping', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const node = makeNode();

    editor.startEditing(node, note.id, store);
    await flushRAF();
    editor.stopEditing(store);

    expect(node.contentEditable).toBe('false');
    expect(node.style.userSelect).toBe('none');
  });

  it('stops previous editing when starting new edit', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const n1 = createNote({ position: { x: 0, y: 0 }, text: 'first' });
    const n2 = createNote({ position: { x: 100, y: 100 }, text: 'second' });
    store.add(n1);
    store.add(n2);
    const node1 = makeNode('first');
    const node2 = makeNode('second');

    editor.startEditing(node1, n1.id, store);
    await flushRAF();
    node1.textContent = 'edited first';

    editor.startEditing(node2, n2.id, store);
    await flushRAF();

    expect(editor.editingElementId).toBe(n2.id);
    const updated = store.getById(n1.id);
    expect(updated && 'text' in updated ? updated.text : '').toBe('edited first');
  });

  it('cleans up on destroy', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, text: 'test' });
    store.add(note);
    const node = makeNode('test');

    editor.startEditing(node, note.id, store);
    await flushRAF();
    node.textContent = 'updated';
    editor.destroy(store);

    expect(editor.isEditing).toBe(false);
    const updated = store.getById(note.id);
    expect(updated && 'text' in updated ? updated.text : '').toBe('updated');
  });

  it('stopEditing is a no-op when not editing', () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    expect(() => editor.stopEditing(store)).not.toThrow();
  });

  it('does not activate if a different edit starts before rAF', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const n1 = createNote({ position: { x: 0, y: 0 } });
    const n2 = createNote({ position: { x: 100, y: 100 } });
    store.add(n1);
    store.add(n2);
    const node1 = makeNode();
    const node2 = makeNode();

    editor.startEditing(node1, n1.id, store);
    editor.startEditing(node2, n2.id, store);
    await flushRAF();

    expect(editor.editingElementId).toBe(n2.id);
    expect(node1.contentEditable).not.toBe('true');
  });

  it('skips if already editing same element', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const node = makeNode();

    editor.startEditing(node, note.id, store);
    await flushRAF();
    expect(editor.isEditing).toBe(true);

    editor.startEditing(node, note.id, store);
    expect(editor.isEditing).toBe(true);
  });

  it('stops propagation of pointerdown while editing', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const node = makeNode();
    document.body.appendChild(node);

    editor.startEditing(node, note.id, store);
    await flushRAF();

    const parentSpy = vi.fn();
    document.body.addEventListener('pointerdown', parentSpy);

    const event = new PointerEvent('pointerdown', { bubbles: true });
    node.dispatchEvent(event);

    expect(parentSpy).not.toHaveBeenCalled();

    document.body.removeEventListener('pointerdown', parentSpy);
    node.remove();
  });

  describe('setOnStop callback', () => {
    it('calls onStop with element id when editing stops', async () => {
      const editor = new NoteEditor();
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 } });
      store.add(note);

      const onStop = vi.fn();
      editor.setOnStop(onStop);

      const node = document.createElement('div');
      node.textContent = 'hello';
      editor.startEditing(node, note.id, store);

      await flushRAF();

      editor.stopEditing(store);
      expect(onStop).toHaveBeenCalledWith(note.id);
    });

    it('does not call onStop if no callback is set', async () => {
      const editor = new NoteEditor();
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 } });
      store.add(note);

      const node = document.createElement('div');
      editor.startEditing(node, note.id, store);

      await flushRAF();

      // Should not throw
      expect(() => editor.stopEditing(store)).not.toThrow();
    });

    it('calls onStop before clearing internal state', async () => {
      const editor = new NoteEditor();
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 } });
      store.add(note);

      let wasEditingDuringCallback = false;
      editor.setOnStop(() => {
        wasEditingDuringCallback = editor.isEditing;
      });

      const node = document.createElement('div');
      editor.startEditing(node, note.id, store);

      await flushRAF();

      editor.stopEditing(store);
      expect(wasEditingDuringCallback).toBe(true);
    });
  });
});
