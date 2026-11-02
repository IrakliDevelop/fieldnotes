/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusBoard, openDialogShell } from './dialog-shell';

function setup() {
  const container = document.createElement('div');
  const wrapper = document.createElement('div');
  wrapper.tabIndex = 0;
  const root = document.createElement('div');
  const input = document.createElement('input');
  root.append(input);
  document.body.append(container, wrapper);
  return { container, wrapper, root, input };
}

function open(
  container: HTMLElement,
  root: HTMLElement,
  initialFocus: HTMLElement,
  onDismiss = vi.fn(),
) {
  return {
    onDismiss,
    dispose: openDialogShell({ container, root, initialFocus, onDismiss, onKeyDown: vi.fn() }),
  };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  document.head
    .querySelectorAll('style[data-fieldnotes-palette]')
    .forEach((style) => style.remove());
});

describe('dialog shell', () => {
  it('mounts the root in the container, appends the stylesheet once and focuses the initial element', () => {
    const { container, root, input } = setup();
    const first = open(container, root, input);
    const secondRoot = document.createElement('div');
    const secondInput = document.createElement('button');
    secondRoot.append(secondInput);
    const second = open(container, secondRoot, secondInput);
    expect(container.lastElementChild).toBe(secondRoot);
    expect(root.tabIndex).toBe(-1);
    expect(root.classList).toContain('fieldnotes-dialog');
    expect(document.head.querySelectorAll('style[data-fieldnotes-palette]')).toHaveLength(1);
    expect(root.style.position).toBe('fixed');
    expect(root.style.zIndex).toBe('2147483647');
    expect(document.activeElement).toBe(secondInput);
    first.dispose();
    second.dispose();
  });

  it('the theme goes into a shadow root when the container lives in one and composed paths decide inside and outside', () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const container = document.createElement('div');
    const root = document.createElement('div');
    const input = document.createElement('input');
    root.append(input);
    shadow.append(container);
    document.body.append(host);
    const { onDismiss, dispose } = open(container, root, input);
    vi.runAllTimers();
    root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    expect(onDismiss).not.toHaveBeenCalled();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(shadow.querySelectorAll('style[data-fieldnotes-palette]')).toHaveLength(1);
    expect(document.head.querySelector('style[data-fieldnotes-palette]')).toBeNull();
    dispose();
  });

  it('keys inside the root never reach window listeners and Escape dismisses', () => {
    const { container, root, input } = setup();
    const { onDismiss, dispose } = open(container, root, input);
    const windowListener = vi.fn();
    window.addEventListener('keydown', windowListener);
    const ordinary = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    input.dispatchEvent(ordinary);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input.dispatchEvent(escape);
    expect(windowListener).not.toHaveBeenCalled();
    expect(ordinary.defaultPrevented).toBe(false);
    expect(escape.defaultPrevented).toBe(true);
    expect(onDismiss).toHaveBeenCalledOnce();
    window.removeEventListener('keydown', windowListener);
    dispose();
  });

  it('a composing key is neither handled nor propagated', () => {
    const { container, root, input } = setup();
    const onKeyDown = vi.fn();
    const dispose = openDialogShell({
      container,
      root,
      initialFocus: input,
      onDismiss: vi.fn(),
      onKeyDown,
    });
    const listener = vi.fn();
    window.addEventListener('keydown', listener);
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);
    const process = new KeyboardEvent('keydown', {
      key: 'Process',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(process, 'keyCode', { value: 229 });
    input.dispatchEvent(process);
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(process.defaultPrevented).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener('keydown', listener);
    dispose();
  });

  it('an Escape outside the root dismisses only from the page or the container', () => {
    const { container, root, input } = setup();
    const { onDismiss, dispose } = open(container, root, input);
    const outside = document.createElement('input');
    const inContainer = document.createElement('div');
    container.append(inContainer);
    document.body.append(outside);
    const host = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    outside.dispatchEvent(host);
    const page = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(page);
    expect(host.defaultPrevented).toBe(false);
    expect(page.defaultPrevented).toBe(true);
    expect(onDismiss).toHaveBeenCalledOnce();
    dispose();
  });

  it('Tab cycles inside the root', () => {
    const { container, root } = setup();
    const first = document.createElement('button');
    const second = document.createElement('button');
    root.replaceChildren(first, second);
    const { dispose } = open(container, root, root);
    second.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    second.dispatchEvent(tab);
    expect(document.activeElement).toBe(first);
    expect(tab.defaultPrevented).toBe(true);
    const shiftTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    first.dispatchEvent(shiftTab);
    expect(document.activeElement).toBe(second);
    expect(shiftTab.defaultPrevented).toBe(true);
    dispose();
  });

  it('a mousedown or pointerdown inside the root keeps focus unless it targets the text input', () => {
    const { container, root, input } = setup();
    const child = document.createElement('button');
    root.append(child);
    const dispose = openDialogShell({
      container,
      root,
      initialFocus: input,
      textInput: input,
      onDismiss: vi.fn(),
      onKeyDown: vi.fn(),
    });
    const mouse = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    child.dispatchEvent(mouse);
    const pointer = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    child.dispatchEvent(pointer);
    const inputMouse = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    input.dispatchEvent(inputMouse);
    expect(mouse.defaultPrevented).toBe(true);
    expect(pointer.defaultPrevented).toBe(true);
    expect(inputMouse.defaultPrevented).toBe(false);
    dispose();
  });

  it('a pointerdown outside closes after the deferral and one inside does not', () => {
    vi.useFakeTimers();
    const { container, root, input } = setup();
    const { onDismiss, dispose } = open(container, root, input);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();
    vi.runAllTimers();
    root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledOnce();
    dispose();
  });

  it('dispose removes the root, listeners and the pending timer', () => {
    vi.useFakeTimers();
    const { container, root, input } = setup();
    const { onDismiss, dispose } = open(container, root, input);
    dispose();
    vi.runAllTimers();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(root.isConnected).toBe(false);
  });

  it('focusBoard focuses the wrapper, or blurs the active element when the wrapper is not focusable', () => {
    const { container, wrapper, root, input } = setup();
    container.append(root);
    input.focus();
    focusBoard(wrapper, root);
    expect(document.activeElement).toBe(wrapper);
    wrapper.removeAttribute('tabindex');
    input.focus();
    focusBoard(wrapper, root);
    expect(document.activeElement).toBe(document.body);
  });
});
