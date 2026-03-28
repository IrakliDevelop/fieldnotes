/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InteractMode } from './interact-mode';

describe('InteractMode', () => {
  let domLayer: HTMLDivElement;
  let nodes: Map<string, HTMLDivElement>;
  let interactMode: InteractMode;

  beforeEach(() => {
    domLayer = document.createElement('div');
    document.body.appendChild(domLayer);
    nodes = new Map();
    interactMode = new InteractMode({
      getNode: (id) => nodes.get(id),
    });
  });

  afterEach(() => {
    domLayer.remove();
  });

  function createNode(id: string): HTMLDivElement {
    const node = document.createElement('div');
    node.style.pointerEvents = 'none';
    domLayer.appendChild(node);
    nodes.set(id, node);
    return node;
  }

  it('startInteracting enables pointer events on the node', () => {
    const node = createNode('el-1');
    interactMode.startInteracting('el-1');
    expect(node.style.pointerEvents).toBe('auto');
  });

  it('startInteracting with missing node id is a no-op', () => {
    expect(() => interactMode.startInteracting('nonexistent')).not.toThrow();
    expect(interactMode.isInteracting()).toBe(false);
  });

  it('stopInteracting disables pointer events on the node', () => {
    const node = createNode('el-1');
    interactMode.startInteracting('el-1');
    interactMode.stopInteracting();
    expect(node.style.pointerEvents).toBe('none');
    expect(interactMode.isInteracting()).toBe(false);
  });

  it('stopInteracting is safe when not interacting', () => {
    expect(() => interactMode.stopInteracting()).not.toThrow();
  });

  it('Escape key exits interact mode', () => {
    createNode('el-1');
    interactMode.startInteracting('el-1');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(interactMode.isInteracting()).toBe(false);
  });

  it('click outside exits interact mode', () => {
    createNode('el-1');
    interactMode.startInteracting('el-1');
    window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(interactMode.isInteracting()).toBe(false);
  });

  it('click inside does not exit interact mode', () => {
    const node = createNode('el-1');
    interactMode.startInteracting('el-1');
    // Dispatch on the node — exits only if node.contains(target) is false
    node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(interactMode.isInteracting()).toBe(true);
  });

  it('starting new interaction stops the previous one', () => {
    const node1 = createNode('el-1');
    const node2 = createNode('el-2');
    interactMode.startInteracting('el-1');
    interactMode.startInteracting('el-2');
    expect(node1.style.pointerEvents).toBe('none');
    expect(node2.style.pointerEvents).toBe('auto');
  });

  it('destroy calls stopInteracting', () => {
    const node = createNode('el-1');
    interactMode.startInteracting('el-1');
    interactMode.destroy();
    expect(node.style.pointerEvents).toBe('none');
    expect(interactMode.isInteracting()).toBe(false);
  });
});
