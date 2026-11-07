// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
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
  it('passes the edited id to history hooks and commits on mod+Enter', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, text: 'text' });
    store.add(note);
    const begin = vi.fn();
    const commit = vi.fn();
    editor.setHistoryHooks(begin, commit);
    const node = makeNode('text');
    document.body.appendChild(node);
    editor.startEditing(node, note.id, store);
    await flushRAF();
    node.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    );
    expect(begin).toHaveBeenCalledWith(note.id);
    expect(commit).toHaveBeenCalledWith(note.id);
    node.remove();
  });

  it.each([{ ctrlKey: true }, { metaKey: true }])(
    'commits on modified Enter',
    async (modifiers) => {
      const editor = new NoteEditor();
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, text: 'text' });
      store.add(note);
      const commit = vi.fn();
      editor.setHistoryHooks(vi.fn(), commit);
      const node = makeNode('text');
      document.body.appendChild(node);
      editor.startEditing(node, note.id, store);
      await flushRAF();
      node.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...modifiers }),
      );

      expect(commit).toHaveBeenCalledWith(note.id);
      node.remove();
    },
  );

  it('keeps editing on plain Enter and preserves a line break', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, text: 'first<br>second' });
    store.add(note);
    const node = makeNode();
    node.innerHTML = 'first<br>second';
    editor.startEditing(node, note.id, store);
    await flushRAF();
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(editor.editingElementId).toBe(note.id);
    expect(node.innerHTML).toBe('first<br>second');
    editor.stopEditing(store);
  });

  it('reports a pending edit abandoned by stopEditing', () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const abandon = vi.fn();
    editor.setOnAbandon(abandon);
    editor.startEditing(makeNode(), note.id, store);
    editor.stopEditing(store);
    expect(abandon).toHaveBeenCalledWith(note.id);
  });
  afterEach(() => {
    document.querySelectorAll('[data-note-toolbar]').forEach((el) => el.remove());
  });

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
    editor.stopEditing(store);
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

  it('keeps a pending session when the same bound text is requested again', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const abandon = vi.fn();
    const begin = vi.fn();
    const commit = vi.fn();
    editor.setOnAbandon(abandon);
    editor.setHistoryHooks(begin, commit);
    const firstNode = makeNode();
    const replacementNode = makeNode();
    const added = vi.fn();
    const removed = vi.fn();
    const updated = vi.fn();
    store.on('add', added);
    store.on('remove', removed);
    store.on('update', updated);

    editor.startEditing(firstNode, note.id, store);
    editor.startEditing(replacementNode, note.id, store);
    await flushRAF();

    expect(editor.editingElementId).toBe(note.id);
    expect(firstNode.contentEditable).toBe('true');
    expect(replacementNode.contentEditable).not.toBe('true');
    expect(begin).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    expect(abandon).not.toHaveBeenCalled();
    expect(added).not.toHaveBeenCalled();
    expect(removed).not.toHaveBeenCalled();
    expect(updated).not.toHaveBeenCalled();
  });

  it('abandons one pending session before activating its replacement', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const first = createNote({ position: { x: 0, y: 0 } });
    const second = createNote({ position: { x: 10, y: 0 } });
    store.add(first);
    store.add(second);
    const abandon = vi.fn();
    editor.setOnAbandon(abandon);

    editor.startEditing(makeNode(), first.id, store);
    editor.startEditing(makeNode(), second.id, store);
    await flushRAF();

    expect(abandon).toHaveBeenCalledTimes(1);
    expect(abandon).toHaveBeenCalledWith(first.id);
    expect(editor.editingElementId).toBe(second.id);
  });

  it('abandons a destroyed pending edit once and ignores its queued frame', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const abandon = vi.fn();
    const begin = vi.fn();
    editor.setOnAbandon(abandon);
    editor.setHistoryHooks(begin, vi.fn());

    editor.startEditing(makeNode(), note.id, store);
    editor.destroy(store);
    await flushRAF();

    expect(abandon).toHaveBeenCalledTimes(1);
    expect(abandon).toHaveBeenCalledWith(note.id);
    expect(begin).not.toHaveBeenCalled();
    expect(editor.editingElementId).toBeNull();
  });

  it('does not let destroyed editor listeners mutate text after recreation', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, text: 'before' });
    store.add(note);
    const node = makeNode('before');
    document.body.appendChild(node);
    editor.startEditing(node, note.id, store);
    await flushRAF();
    editor.destroy(store);
    const before = structuredClone(store.getAll());

    node.textContent = 'after';
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    node.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

    expect(store.getAll()).toEqual(before);
    expect(editor.editingElementId).toBeNull();
    node.remove();
  });

  it('commits one active session before activating its replacement', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const first = createNote({ position: { x: 0, y: 0 } });
    const second = createNote({ position: { x: 10, y: 0 } });
    store.add(first);
    store.add(second);
    const commit = vi.fn();
    editor.setHistoryHooks(vi.fn(), commit);

    editor.startEditing(makeNode(), first.id, store);
    await flushRAF();
    editor.startEditing(makeNode(), second.id, store);
    await flushRAF();

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(first.id);
    editor.stopEditing(store);
  });

  it('keeps the active node and history session when asked to edit it again', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const node = makeNode();
    const replacementNode = makeNode();
    const begin = vi.fn();
    const commit = vi.fn();
    const abandon = vi.fn();
    const added = vi.fn();
    const removed = vi.fn();
    const updates = vi.fn();
    store.on('add', added);
    store.on('remove', removed);
    store.on('update', updates);
    editor.setHistoryHooks(begin, commit);
    editor.setOnAbandon(abandon);

    editor.startEditing(node, note.id, store);
    await flushRAF();
    expect(editor.isEditing).toBe(true);

    editor.startEditing(replacementNode, note.id, store);
    expect(editor.isEditing).toBe(true);
    expect(node.contentEditable).toBe('true');
    expect(replacementNode.contentEditable).not.toBe('true');
    expect(begin).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    expect(abandon).not.toHaveBeenCalled();
    expect(added).not.toHaveBeenCalled();
    expect(removed).not.toHaveBeenCalled();
    expect(updates).not.toHaveBeenCalled();
    editor.stopEditing(store);
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
    editor.stopEditing(store);
    node.remove();
  });

  it('saves innerHTML (not textContent) on stopEditing', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, text: 'old' });
    store.add(note);
    const node = makeNode('old');

    editor.startEditing(node, note.id, store);
    await flushRAF();

    node.innerHTML = '<b>bold text</b>';
    editor.stopEditing(store);

    const updated = store.getById(note.id);
    expect(updated && 'text' in updated ? updated.text : '').toBe('<b>bold text</b>');
  });

  it('sanitizes HTML on stopEditing', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const node = makeNode('');

    editor.startEditing(node, note.id, store);
    await flushRAF();

    node.innerHTML = '<script>alert("xss")</script><b>safe</b>';
    editor.stopEditing(store);

    const updated = store.getById(note.id);
    const text = updated && 'text' in updated ? updated.text : '';
    expect(text).not.toContain('<script>');
    expect(text).toContain('<b>safe</b>');
  });

  it('shows toolbar on startEditing', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const node = makeNode('');
    document.body.appendChild(node);

    editor.startEditing(node, note.id, store);
    await flushRAF();

    expect(document.querySelector('[data-note-toolbar]')).not.toBeNull();

    editor.stopEditing(store);
    node.remove();
  });

  it('hides toolbar on stopEditing', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const node = makeNode('');
    document.body.appendChild(node);

    editor.startEditing(node, note.id, store);
    await flushRAF();

    editor.stopEditing(store);
    expect(document.querySelector('[data-note-toolbar]')).toBeNull();
    node.remove();
  });

  it('applies bold with Ctrl+B shortcut', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const node = makeNode('text');
    document.body.appendChild(node);

    editor.startEditing(node, note.id, store);
    await flushRAF();

    const execSpy = vi.spyOn(document, 'execCommand').mockReturnValue(true);
    const event = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true });
    node.dispatchEvent(event);

    expect(execSpy).toHaveBeenCalledWith('bold');
    execSpy.mockRestore();

    editor.stopEditing(store);
    node.remove();
  });

  it('applies italic with Ctrl+I shortcut', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const node = makeNode('text');
    document.body.appendChild(node);

    editor.startEditing(node, note.id, store);
    await flushRAF();

    const execSpy = vi.spyOn(document, 'execCommand').mockReturnValue(true);
    const event = new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, bubbles: true });
    node.dispatchEvent(event);

    expect(execSpy).toHaveBeenCalledWith('italic');
    execSpy.mockRestore();

    editor.stopEditing(store);
    node.remove();
  });

  it('applies underline with Ctrl+U shortcut', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const node = makeNode('text');
    document.body.appendChild(node);

    editor.startEditing(node, note.id, store);
    await flushRAF();

    const execSpy = vi.spyOn(document, 'execCommand').mockReturnValue(true);
    const event = new KeyboardEvent('keydown', { key: 'u', ctrlKey: true, bubbles: true });
    node.dispatchEvent(event);

    expect(execSpy).toHaveBeenCalledWith('underline');
    execSpy.mockRestore();

    editor.stopEditing(store);
    node.remove();
  });

  it('does not stop editing when focus moves to toolbar', async () => {
    const editor = new NoteEditor();
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const node = makeNode('text');
    document.body.appendChild(node);

    editor.startEditing(node, note.id, store);
    await flushRAF();

    const toolbar = document.querySelector('[data-note-toolbar]');
    expect(toolbar).not.toBeNull();

    const select = toolbar?.querySelector('select');
    node.dispatchEvent(new FocusEvent('blur', { relatedTarget: select }));

    expect(editor.isEditing).toBe(true);

    editor.stopEditing(store);
    node.remove();
  });

  it('does not show toolbar when toolbar option is false', async () => {
    const editor = new NoteEditor({ toolbar: false });
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const node = makeNode('text');
    document.body.appendChild(node);

    editor.startEditing(node, note.id, store);
    await flushRAF();

    expect(document.querySelector('[data-note-toolbar]')).toBeNull();
    expect(editor.isEditing).toBe(true);

    editor.stopEditing(store);
    node.remove();
  });

  describe('editing placeholder', () => {
    afterEach(() => {
      document.querySelectorAll('style[data-fieldnotes-editor]').forEach((el) => el.remove());
    });

    it('sets placeholder attributes on start and removes them on stop', async () => {
      const editor = new NoteEditor();
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, text: '' });
      store.add(note);
      const node = makeNode('');

      editor.startEditing(node, note.id, store);
      await flushRAF();

      expect(node.getAttribute('data-fn-placeholder')).toBe('Type…');
      expect(node.getAttribute('data-fn-empty')).toBe('true');

      editor.stopEditing(store);
      expect(node.hasAttribute('data-fn-placeholder')).toBe(false);
      expect(node.hasAttribute('data-fn-empty')).toBe(false);
    });

    it('uses a custom placeholder string', async () => {
      const editor = new NoteEditor({ placeholder: 'Schreib…' });
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, text: '' });
      store.add(note);
      const node = makeNode('');

      editor.startEditing(node, note.id, store);
      await flushRAF();
      expect(node.getAttribute('data-fn-placeholder')).toBe('Schreib…');
      editor.stopEditing(store);
    });

    it('toggles data-fn-empty on input in both directions', async () => {
      const editor = new NoteEditor();
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, text: '' });
      store.add(note);
      const node = makeNode('');

      editor.startEditing(node, note.id, store);
      await flushRAF();
      expect(node.getAttribute('data-fn-empty')).toBe('true');

      node.textContent = 'x';
      node.dispatchEvent(new Event('input'));
      expect(node.getAttribute('data-fn-empty')).toBe('false');

      node.textContent = '';
      node.dispatchEvent(new Event('input'));
      expect(node.getAttribute('data-fn-empty')).toBe('true');
      editor.stopEditing(store);
    });

    it('starts non-empty for a node with content', async () => {
      const editor = new NoteEditor();
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, text: 'hello' });
      store.add(note);
      const node = makeNode('hello');

      editor.startEditing(node, note.id, store);
      await flushRAF();
      expect(node.getAttribute('data-fn-empty')).toBe('false');
      editor.stopEditing(store);
    });

    it('injects the editor stylesheet exactly once', async () => {
      const a = new NoteEditor();
      const b = new NoteEditor();
      const store = new ElementStore();
      const n1 = createNote({ position: { x: 0, y: 0 }, text: '' });
      const n2 = createNote({ position: { x: 10, y: 10 }, text: '' });
      store.add(n1);
      store.add(n2);
      const node1 = makeNode('');
      const node2 = makeNode('');

      a.startEditing(node1, n1.id, store);
      await flushRAF();
      a.stopEditing(store);
      b.startEditing(node2, n2.id, store);
      await flushRAF();
      b.stopEditing(store);

      expect(document.querySelectorAll('style[data-fieldnotes-editor]').length).toBe(1);
    });
  });

  describe('phantom-undo avoidance', () => {
    it('does not call store.update when the note text is unchanged on stop', async () => {
      const editor = new NoteEditor();
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, text: '<b>hi</b>' });
      store.add(note);
      const node = makeNode('');
      node.innerHTML = '<b>hi</b>';

      editor.startEditing(node, note.id, store);
      await flushRAF();
      const spy = vi.spyOn(store, 'update');
      editor.stopEditing(store);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('calls store.update when the note text changed on stop', async () => {
      const editor = new NoteEditor();
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, text: '<b>hi</b>' });
      store.add(note);
      const node = makeNode('');
      node.innerHTML = '<b>hi</b>';

      editor.startEditing(node, note.id, store);
      await flushRAF();
      node.innerHTML = '<b>changed</b>';
      const spy = vi.spyOn(store, 'update');
      editor.stopEditing(store);
      expect(spy).toHaveBeenCalledWith(note.id, { text: expect.stringContaining('changed') });
      spy.mockRestore();
    });
  });

  describe('history transaction spans the edit session', () => {
    it('begins history at activate and commits once at stop', async () => {
      const editor = new NoteEditor();
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, text: 'hi' });
      store.add(note);
      const node = makeNode('hi');

      const beginSpy = vi.fn();
      const commitSpy = vi.fn();
      editor.setHistoryHooks(beginSpy, commitSpy);

      editor.startEditing(node, note.id, store);
      expect(beginSpy).not.toHaveBeenCalled();

      await flushRAF();
      expect(beginSpy).toHaveBeenCalledTimes(1);
      expect(commitSpy).not.toHaveBeenCalled();

      editor.stopEditing(store);
      expect(commitSpy).toHaveBeenCalledTimes(1);
      expect(beginSpy).toHaveBeenCalledTimes(1);
    });

    it('calls the onInput callback with the element id on input', async () => {
      const editor = new NoteEditor();
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, text: '' });
      store.add(note);
      const node = makeNode('');

      const inputSpy = vi.fn();
      editor.setOnInput(inputSpy);

      editor.startEditing(node, note.id, store);
      await flushRAF();

      node.textContent = 'x';
      node.dispatchEvent(new Event('input'));
      expect(inputSpy).toHaveBeenCalledWith(note.id);

      editor.stopEditing(store);
    });
  });

  describe('focus return', () => {
    let node: HTMLDivElement;
    let target: HTMLDivElement;

    afterEach(() => {
      node.remove();
      target.remove();
    });

    async function startFocused(): Promise<{ editor: NoteEditor; store: ElementStore }> {
      const editor = new NoteEditor();
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, text: 'hi' });
      store.add(note);
      node = makeNode('hi');
      node.tabIndex = 0;
      target = document.createElement('div');
      target.tabIndex = 0;
      document.body.append(node, target);
      editor.setFocusReturnTarget(target);
      editor.startEditing(node, note.id, store);
      await flushRAF();
      return { editor, store };
    }

    it('returns focus to the target when Escape ends the edit', async () => {
      const { editor } = await startFocused();
      expect(document.activeElement).toBe(node);

      node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(document.activeElement).toBe(target);
      expect(editor.isEditing).toBe(false);
    });

    it('returns focus to the target when stopEditing runs while the node has focus', async () => {
      const { editor, store } = await startFocused();
      expect(document.activeElement).toBe(node);

      editor.stopEditing(store);

      expect(document.activeElement).toBe(target);
    });

    it('does not take focus back when the user moved focus elsewhere', async () => {
      const { editor } = await startFocused();
      const input = document.createElement('input');
      document.body.append(input);
      const focusSpy = vi.spyOn(target, 'focus');

      input.focus();

      expect(editor.isEditing).toBe(false);
      expect(document.activeElement).toBe(input);
      expect(focusSpy).not.toHaveBeenCalled();
      input.remove();
    });

    it('focuses the target with preventScroll', async () => {
      const { editor, store } = await startFocused();
      const focusSpy = vi.spyOn(target, 'focus');

      editor.stopEditing(store);

      expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    });

    it('releases focus from the node when no target can take it', async () => {
      await startFocused();
      target.removeAttribute('tabindex');
      expect(document.activeElement).toBe(node);

      node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(document.activeElement).not.toBe(node);
      expect(node.contains(document.activeElement)).toBe(false);
    });

    it('returns focus to the target when the edit stops while the toolbar has focus', async () => {
      const { editor, store } = await startFocused();
      const button = document.querySelector<HTMLButtonElement>('[data-note-toolbar] button');
      if (!button) throw new Error('toolbar button not found');
      button.focus();
      expect(document.activeElement).toBe(button);
      expect(editor.isEditing).toBe(true);

      editor.stopEditing(store);

      expect(document.activeElement).toBe(target);
    });
  });
});
