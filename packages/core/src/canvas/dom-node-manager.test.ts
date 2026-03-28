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

    it('calls onEditRequest on dblclick', () => {
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
      });
      manager.syncDomNode(note);
      const node = manager.getNode(note.id);
      node?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      expect(onEditRequest).toHaveBeenCalledWith(note.id);
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
});
