/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DomNodeManager } from './dom-node-manager';
import { ElementStore } from '../elements/element-store';
import {
  createNote,
  createText,
  createHtmlElement,
  createStroke,
} from '../elements/element-factory';

describe('DomNodeManager', () => {
  let domLayer: HTMLDivElement;
  let onEditRequest: ReturnType<typeof vi.fn>;
  let isEditingElement: ReturnType<typeof vi.fn>;
  let manager: DomNodeManager;

  beforeEach(() => {
    domLayer = document.createElement('div');
    document.body.appendChild(domLayer);
    onEditRequest = vi.fn();
    isEditingElement = vi.fn().mockReturnValue(false);
    manager = new DomNodeManager({
      domLayer,
      onEditRequest,
      isEditingElement,
    });
  });

  afterEach(() => {
    domLayer.remove();
  });

  describe('syncDomNode', () => {
    it('creates a positioned DOM node for an element', () => {
      const note = createNote({
        position: { x: 100, y: 200 },
        size: { w: 300, h: 150 },
      });
      manager.syncDomNode(note);
      const node = manager.getNode(note.id);
      expect(node).toBeDefined();
      expect(node?.style.left).toBe('100px');
      expect(node?.style.top).toBe('200px');
      expect(node?.style.width).toBe('300px');
      expect(node?.style.height).toBe('150px');
      expect(domLayer.contains(node)).toBe(true);
    });

    it('reuses existing node on second call', () => {
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
      });
      manager.syncDomNode(note);
      const node1 = manager.getNode(note.id);
      manager.syncDomNode({ ...note, position: { x: 50, y: 50 } });
      const node2 = manager.getNode(note.id);
      expect(node1).toBe(node2);
      expect(node2?.style.left).toBe('50px');
    });

    it('applies zIndex parameter', () => {
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
      });
      manager.syncDomNode(note, 5);
      expect(manager.getNode(note.id)?.style.zIndex).toBe('5');
    });
  });

  describe('renderDomContent — note', () => {
    it('applies note styling on first render', () => {
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
        text: 'Hello',
        backgroundColor: '#ffeb3b',
        textColor: '#333',
      });
      manager.syncDomNode(note);
      const node = manager.getNode(note.id);
      expect(node?.textContent).toBe('Hello');
      expect(node?.style.backgroundColor).toBe('rgb(255, 235, 59)');
      expect(node?.style.color).toBe('rgb(51, 51, 51)');
    });

    it('updates text when not editing', () => {
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
        text: 'Original',
      });
      manager.syncDomNode(note);
      manager.syncDomNode({ ...note, text: 'Updated' });
      expect(manager.getNode(note.id)?.textContent).toBe('Updated');
    });

    it('skips text update when editing', () => {
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
        text: 'Original',
      });
      manager.syncDomNode(note);
      isEditingElement.mockReturnValue(true);
      manager.syncDomNode({ ...note, text: 'Should not appear' });
      expect(manager.getNode(note.id)?.textContent).toBe('Original');
    });

    it('calls onEditRequest on double-tap (two pointerup events)', () => {
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
      });
      manager.syncDomNode(note);
      const node = manager.getNode(note.id);
      node?.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }),
      );
      node?.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }),
      );
      expect(onEditRequest).toHaveBeenCalledWith(note.id);
    });

    it('does not call onEditRequest on single tap', () => {
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
      });
      manager.syncDomNode(note);
      const node = manager.getNode(note.id);
      node?.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }),
      );
      expect(onEditRequest).not.toHaveBeenCalled();
    });
  });

  describe('renderDomContent — note with HTML', () => {
    it('renders HTML content in note', () => {
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
        text: '<b>bold</b> text',
      });
      manager.syncDomNode(note);
      const node = manager.getNode(note.id);
      expect(node?.innerHTML).toContain('<b>bold</b>');
    });

    it('renders pre-sanitized HTML as-is', () => {
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
        text: '<b>bold</b> and <i>italic</i>',
      });
      manager.syncDomNode(note);
      const node = manager.getNode(note.id);
      expect(node?.innerHTML).toContain('<b>bold</b>');
      expect(node?.innerHTML).toContain('<i>italic</i>');
    });

    it('applies fontSize style', () => {
      const note = {
        ...createNote({
          position: { x: 0, y: 0 },
          size: { w: 200, h: 100 },
          fontSize: 18,
        }),
      };
      manager.syncDomNode(note);
      const node = manager.getNode(note.id);
      expect(node?.style.fontSize).toBe('18px');
    });

    it('defaults fontSize to 18px', () => {
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
      });
      manager.syncDomNode(note);
      const node = manager.getNode(note.id);
      expect(node?.style.fontSize).toBe('18px');
    });

    it('updates innerHTML when not editing', () => {
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
        text: 'plain',
      });
      manager.syncDomNode(note);
      manager.syncDomNode({ ...note, text: '<i>updated</i>' });
      const node = manager.getNode(note.id);
      expect(node?.innerHTML).toContain('<i>updated</i>');
    });
  });

  describe('renderDomContent — text', () => {
    it('applies text styling on first render', () => {
      const text = createText({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 50 },
        text: 'Title',
        fontSize: 24,
        color: '#000',
        textAlign: 'center',
      });
      manager.syncDomNode(text);
      const node = manager.getNode(text.id);
      expect(node?.textContent).toBe('Title');
      expect(node?.style.fontSize).toBe('24px');
      expect(node?.style.color).toBe('rgb(0, 0, 0)');
      expect(node?.style.textAlign).toBe('center');
    });

    it('updates text style properties', () => {
      const text = createText({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 50 },
        text: 'Title',
        fontSize: 16,
        color: '#000',
        textAlign: 'left',
      });
      manager.syncDomNode(text);
      manager.syncDomNode({ ...text, fontSize: 32, color: '#f00' });
      const node = manager.getNode(text.id);
      expect(node?.style.fontSize).toBe('32px');
      expect(node?.style.color).toBe('rgb(255, 0, 0)');
    });
  });

  describe('renderDomContent — html', () => {
    it('appends stored html content', () => {
      const el = createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
      });
      const content = document.createElement('span');
      content.textContent = 'Widget';
      manager.storeHtmlContent(el.id, content);
      manager.syncDomNode(el);
      const node = manager.getNode(el.id);
      expect(node?.contains(content)).toBe(true);
    });
  });

  describe('renderDomContent — unknown element type', () => {
    it('positions node without adding content', () => {
      const stroke = createStroke({
        position: { x: 10, y: 20 },
        points: [{ x: 0, y: 0, pressure: 0.5 }],
      });
      manager.syncDomNode(stroke);
      const node = manager.getNode(stroke.id);
      expect(node).toBeDefined();
      expect(node?.style.left).toBe('10px');
      expect(node?.children.length).toBe(0);
    });
  });

  describe('hideDomNode', () => {
    it('sets display none on the node', () => {
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
      });
      manager.syncDomNode(note);
      manager.hideDomNode(note.id);
      expect(manager.getNode(note.id)?.style.display).toBe('none');
    });
  });

  describe('removeDomNode', () => {
    it('removes node from DOM and maps', () => {
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
      });
      manager.syncDomNode(note);
      expect(domLayer.children.length).toBe(1);
      manager.removeDomNode(note.id);
      expect(manager.getNode(note.id)).toBeUndefined();
      expect(domLayer.children.length).toBe(0);
    });

    it('is a no-op for non-existent ID', () => {
      expect(() => manager.removeDomNode('does-not-exist')).not.toThrow();
      expect(domLayer.children.length).toBe(0);
    });
  });

  describe('getNode', () => {
    it('returns undefined for missing ID', () => {
      expect(manager.getNode('missing-id')).toBeUndefined();
    });
  });

  describe('clearDomNodes', () => {
    it('removes all nodes', () => {
      const n1 = createNote({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
      });
      const n2 = createNote({
        position: { x: 100, y: 0 },
        size: { w: 100, h: 100 },
      });
      manager.syncDomNode(n1);
      manager.syncDomNode(n2);
      expect(domLayer.children.length).toBe(2);
      manager.clearDomNodes();
      expect(domLayer.children.length).toBe(0);
      expect(manager.getNode(n1.id)).toBeUndefined();
      expect(manager.getNode(n2.id)).toBeUndefined();
    });
  });

  describe('reattachHtmlContent', () => {
    it('links html elements by domId', () => {
      const dom = document.createElement('div');
      dom.id = 'my-widget';
      document.body.appendChild(dom);

      const store = new ElementStore();
      const el = createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
        domId: 'my-widget',
      });
      store.add(el);

      manager.reattachHtmlContent(store);
      manager.syncDomNode(el);
      const node = manager.getNode(el.id);
      expect(node?.contains(dom)).toBe(true);

      dom.remove();
    });
  });

  describe('storeHtmlContent', () => {
    it('registers content for later rendering', () => {
      const el = createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
      });
      const content = document.createElement('div');
      content.textContent = 'Custom';
      manager.storeHtmlContent(el.id, content);
      manager.syncDomNode(el);
      expect(manager.getNode(el.id)?.contains(content)).toBe(true);
    });
  });

  describe('renderDomContent — text edge cases', () => {
    it('calls onEditRequest on text element double-tap', () => {
      const text = createText({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 50 },
        text: 'Hello',
        fontSize: 16,
        color: '#000',
        textAlign: 'left',
      });
      manager.syncDomNode(text);
      const node = manager.getNode(text.id);
      node?.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }),
      );
      node?.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }),
      );
      expect(onEditRequest).toHaveBeenCalledWith(text.id);
    });

    it('skips text update when editing', () => {
      const text = createText({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 50 },
        text: 'Original',
        fontSize: 16,
        color: '#000',
        textAlign: 'left',
      });
      manager.syncDomNode(text);
      isEditingElement.mockReturnValue(true);
      manager.syncDomNode({ ...text, text: 'Changed' });
      expect(manager.getNode(text.id)?.textContent).toBe('Original');
    });

    it('uses empty string when text is undefined', () => {
      const text = createText({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 50 },
        text: '',
        fontSize: 16,
        color: '#000',
        textAlign: 'left',
      });
      manager.syncDomNode(text);
      expect(manager.getNode(text.id)?.textContent).toBe('');
    });
  });

  describe('syncDomNode — element without size', () => {
    it('sets width/height to auto for elements without size', () => {
      const stroke = createStroke({
        position: { x: 10, y: 20 },
        points: [{ x: 0, y: 0, pressure: 0.5 }],
      });
      manager.syncDomNode(stroke);
      const node = manager.getNode(stroke.id);
      expect(node?.style.width).toBe('auto');
      expect(node?.style.height).toBe('auto');
    });
  });

  describe('renderDomContent — html without stored content', () => {
    it('does not initialize html element when no content stored', () => {
      const el = createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
      });
      manager.syncDomNode(el);
      const node = manager.getNode(el.id);
      expect(node?.dataset['initialized']).toBeUndefined();
    });
  });

  describe('hideDomNode — non-existent', () => {
    it('is a no-op for unknown ID', () => {
      expect(() => manager.hideDomNode('does-not-exist')).not.toThrow();
    });
  });

  describe('reattachHtmlContent — missing DOM element', () => {
    it('skips html elements without domId', () => {
      const store = new ElementStore();
      const el = createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
      });
      store.add(el);
      expect(() => manager.reattachHtmlContent(store)).not.toThrow();
    });

    it('skips when DOM element not found by id', () => {
      const store = new ElementStore();
      const el = createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
        domId: 'does-not-exist-in-dom',
      });
      store.add(el);
      expect(() => manager.reattachHtmlContent(store)).not.toThrow();
    });
  });

  describe('renderDomContent — html interactive', () => {
    it('sets pointerEvents to none for non-interactive html element', () => {
      const el = createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
      });
      const content = document.createElement('div');
      manager.storeHtmlContent(el.id, content);
      manager.syncDomNode(el);
      const node = manager.getNode(el.id);
      expect(node?.style.pointerEvents).toBe('none');
    });

    it('sets pointerEvents to auto for interactive html element', () => {
      const el = createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
        interactive: true,
      });
      const content = document.createElement('div');
      manager.storeHtmlContent(el.id, content);
      manager.syncDomNode(el);
      const node = manager.getNode(el.id);
      expect(node?.style.pointerEvents).toBe('auto');
    });

    it('updates pointerEvents when interactive flag is toggled via re-sync', () => {
      const el = createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
      });
      const content = document.createElement('div');
      manager.storeHtmlContent(el.id, content);
      manager.syncDomNode(el);
      const node = manager.getNode(el.id);
      expect(node?.style.pointerEvents).toBe('none');

      manager.syncDomNode({ ...el, interactive: true });
      expect(node?.style.pointerEvents).toBe('auto');

      manager.syncDomNode({ ...el, interactive: false });
      expect(node?.style.pointerEvents).toBe('none');
    });
  });

  describe('hasContent', () => {
    it('returns false when no content is stored', () => {
      expect(manager.hasContent('nonexistent')).toBe(false);
    });

    it('returns true after storeHtmlContent', () => {
      const content = document.createElement('div');
      manager.storeHtmlContent('html-1', content);
      expect(manager.hasContent('html-1')).toBe(true);
    });

    it('returns false after removeDomNode clears stored content', () => {
      const content = document.createElement('div');
      manager.storeHtmlContent('html-1', content);
      manager.removeDomNode('html-1');
      expect(manager.hasContent('html-1')).toBe(false);
    });
  });

  describe('resetHtmlContent', () => {
    it('clears container children and resets initialized flag', () => {
      const el = createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
      });
      const content = document.createElement('span');
      content.textContent = 'old';
      manager.storeHtmlContent(el.id, content);
      manager.syncDomNode(el);

      const node = manager.getNode(el.id);
      expect(node?.children.length).toBeGreaterThan(0);
      expect(node?.dataset['initialized']).toBe('true');

      manager.resetHtmlContent(el.id);

      expect(node?.children.length).toBe(0);
      expect(node?.dataset['initialized']).toBeUndefined();
    });

    it('does nothing for non-existent element', () => {
      expect(() => manager.resetHtmlContent('nonexistent')).not.toThrow();
    });

    it('clears stored html content', () => {
      const content = document.createElement('div');
      manager.storeHtmlContent('html-1', content);
      manager.resetHtmlContent('html-1');
      expect(manager.hasContent('html-1')).toBe(false);
    });
  });

  describe('renderDomContent — note text unchanged', () => {
    it('does not update innerHTML when text has not changed', () => {
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
        text: 'Same',
      });
      manager.syncDomNode(note);
      const node = manager.getNode(note.id);
      const spy = vi.spyOn(node as HTMLDivElement, 'innerHTML', 'set');

      manager.syncDomNode({ ...note });
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('rotation', () => {
    it('applies a CSS rotate transform to a rotated node', () => {
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
      note.rotation = Math.PI / 4;
      manager.syncDomNode(note, 0);
      const node = manager.getNode(note.id);
      expect(node?.style.transform).toBe(`rotate(${Math.PI / 4}rad)`);
      expect(node?.style.transformOrigin).toBe('50% 50%');
    });

    it('clears the transform when rotation is unset', () => {
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
      manager.syncDomNode(note, 0);
      const node = manager.getNode(note.id);
      expect(node?.style.transform).toBe('');
    });
  });

  describe('dirty tracking', () => {
    it('skips DOM updates when element version and zIndex unchanged', () => {
      const version = 0;
      const trackedManager = new DomNodeManager({
        domLayer,
        onEditRequest,
        isEditingElement,
        getVersion: () => version,
      });

      const note = createNote({
        position: { x: 100, y: 200 },
        size: { w: 300, h: 150 },
      });

      trackedManager.syncDomNode(note, 0);
      const node = trackedManager.getNode(note.id);
      expect(node).toBeDefined();
      expect(node?.style.left).toBe('100px');

      const modified = { ...note, position: { x: 999, y: 999 } };
      trackedManager.syncDomNode(modified, 0);
      expect(node?.style.left).toBe('100px');
    });

    it('updates DOM when element version changes', () => {
      let version = 0;
      const trackedManager = new DomNodeManager({
        domLayer,
        onEditRequest,
        isEditingElement,
        getVersion: () => version,
      });

      const note = createNote({
        position: { x: 100, y: 200 },
        size: { w: 300, h: 150 },
      });

      trackedManager.syncDomNode(note, 0);
      const node = trackedManager.getNode(note.id);
      expect(node?.style.left).toBe('100px');

      version = 1;
      const moved = { ...note, position: { x: 500, y: 500 } };
      trackedManager.syncDomNode(moved, 0);
      expect(node?.style.left).toBe('500px');
    });

    it('updates DOM when zIndex changes even if version unchanged', () => {
      const version = 0;
      const trackedManager = new DomNodeManager({
        domLayer,
        onEditRequest,
        isEditingElement,
        getVersion: () => version,
      });

      const note = createNote({
        position: { x: 100, y: 200 },
        size: { w: 300, h: 150 },
      });

      trackedManager.syncDomNode(note, 0);
      const node = trackedManager.getNode(note.id);
      expect(node?.style.zIndex).toBe('0');

      trackedManager.syncDomNode(note, 5);
      expect(node?.style.zIndex).toBe('5');
    });

    it('always syncs first time (no cached version)', () => {
      const trackedManager = new DomNodeManager({
        domLayer,
        onEditRequest,
        isEditingElement,
        getVersion: () => 0,
      });

      const note = createNote({
        position: { x: 42, y: 99 },
        size: { w: 300, h: 150 },
      });

      trackedManager.syncDomNode(note, 3);
      const node = trackedManager.getNode(note.id);
      expect(node?.style.left).toBe('42px');
      expect(node?.style.zIndex).toBe('3');
    });

    it('clears tracking on removeDomNode', () => {
      const version = 0;
      const trackedManager = new DomNodeManager({
        domLayer,
        onEditRequest,
        isEditingElement,
        getVersion: () => version,
      });

      const note = createNote({
        position: { x: 100, y: 200 },
        size: { w: 300, h: 150 },
      });

      trackedManager.syncDomNode(note, 0);
      trackedManager.removeDomNode(note.id);

      trackedManager.syncDomNode(note, 0);
      const node = trackedManager.getNode(note.id);
      expect(node?.style.left).toBe('100px');
    });

    it('clears tracking on clearDomNodes', () => {
      const version = 0;
      const trackedManager = new DomNodeManager({
        domLayer,
        onEditRequest,
        isEditingElement,
        getVersion: () => version,
      });

      const note = createNote({
        position: { x: 100, y: 200 },
        size: { w: 300, h: 150 },
      });

      trackedManager.syncDomNode(note, 0);
      trackedManager.clearDomNodes();

      trackedManager.syncDomNode(note, 0);
      const node = trackedManager.getNode(note.id);
      expect(node?.style.left).toBe('100px');
    });

    it('works without getVersion (no dirty tracking)', () => {
      const note = createNote({
        position: { x: 100, y: 200 },
        size: { w: 300, h: 150 },
      });

      manager.syncDomNode(note, 0);
      const node = manager.getNode(note.id);
      expect(node?.style.left).toBe('100px');

      const moved = { ...note, position: { x: 999, y: 999 } };
      manager.syncDomNode(moved, 0);
      expect(node?.style.left).toBe('999px');
    });
  });
});
