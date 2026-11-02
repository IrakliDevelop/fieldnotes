/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusBoard, openDialogShell } from './dialog-shell';

const cleanup: (() => void)[] = [];

function own(dispose: () => void): () => void {
  let disposed = false;
  const owned = () => {
    if (disposed) return;
    disposed = true;
    dispose();
  };
  cleanup.push(owned);
  return owned;
}

function listen(
  target: Window | Document,
  type: string,
  listener: EventListener,
  options?: boolean | AddEventListenerOptions,
): void {
  target.addEventListener(type, listener, options);
  own(() => target.removeEventListener(type, listener, options));
}

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
    dispose: own(openDialogShell({ container, root, initialFocus, onDismiss, onKeyDown: vi.fn() })),
  };
}

afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
  vi.useRealTimers();
  document.body.replaceChildren();
  document.head
    .querySelectorAll('style[data-fieldnotes-palette]')
    .forEach((style) => style.remove());
});

describe('dialog shell', () => {
  it('uses the public palette variables with their approved fallbacks', () => {
    const { container, root, input } = setup();
    open(container, root, input);
    const styles = document.head.querySelector('style[data-fieldnotes-palette]')?.textContent;
    expect(styles).toContain('background: var(--fieldnotes-palette-bg, #fff)');
    expect(styles).toContain('color: var(--fieldnotes-palette-fg, #1a1a1a)');
    expect(styles).toContain('color: var(--fieldnotes-palette-muted, #6b7280)');
    expect(styles).toContain('border: 1px solid var(--fieldnotes-palette-border, #d1d5db)');
    expect(styles).toContain('background: var(--fieldnotes-palette-active, #e8f0fe)');
    expect(styles).toContain(
      'box-shadow: var(--fieldnotes-palette-shadow, 0 8px 24px rgba(0, 0, 0, 0.18))',
    );
    expect(styles).toContain('font: var(--fieldnotes-palette-font, 14px system-ui, sans-serif)');
    expect(styles).toContain('.fieldnotes-palette-option--active');
    expect(styles).not.toMatch(/--fieldnotes-palette-[\w-]+:/);
  });

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
    const outside = document.createElement('button');
    const root = document.createElement('div');
    const input = document.createElement('input');
    root.append(input);
    shadow.append(container, outside);
    document.body.append(host);
    const { onDismiss, dispose } = open(container, root, input);
    vi.runAllTimers();
    root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    expect(onDismiss).not.toHaveBeenCalled();
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(shadow.querySelectorAll('style[data-fieldnotes-palette]')).toHaveLength(1);
    expect(document.head.querySelector('style[data-fieldnotes-palette]')).toBeNull();
    dispose();
  });

  it('a closed shadow root keeps inside presses open and dismisses from an outside sibling', () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'closed' });
    const container = document.createElement('div');
    const outside = document.createElement('button');
    const root = document.createElement('div');
    const input = document.createElement('input');
    root.append(input);
    shadow.append(container, outside);
    document.body.append(host);
    const { onDismiss } = open(container, root, input);
    vi.runAllTimers();
    root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    expect(onDismiss).not.toHaveBeenCalled();
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('keys inside the root never reach window listeners and Escape dismisses', () => {
    const { container, root, input } = setup();
    const documentListener = vi.fn();
    const windowListener = vi.fn();
    listen(document, 'keydown', documentListener);
    listen(window, 'keydown', windowListener);
    const { onDismiss } = open(container, root, input);
    const ordinary = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    input.dispatchEvent(ordinary);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input.dispatchEvent(escape);
    expect(documentListener).not.toHaveBeenCalled();
    expect(windowListener).not.toHaveBeenCalled();
    expect(ordinary.defaultPrevented).toBe(false);
    expect(escape.defaultPrevented).toBe(true);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('a composing key is neither handled nor propagated', () => {
    const { container, root, input } = setup();
    const onKeyDown = vi.fn();
    own(
      openDialogShell({
        container,
        root,
        initialFocus: input,
        onDismiss: vi.fn(),
        onKeyDown,
      }),
    );
    const listener = vi.fn();
    listen(window, 'keydown', listener);
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
  });

  it('an Escape outside the root dismisses only from the page or the container', () => {
    const { container, root, input } = setup();
    const documentListener = vi.fn();
    listen(document, 'keydown', documentListener);
    const { onDismiss } = open(container, root, input);
    const outside = document.createElement('input');
    const inContainer = document.createElement('div');
    container.append(inContainer);
    document.body.append(outside);
    const host = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    outside.dispatchEvent(host);
    expect(host.defaultPrevented).toBe(false);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(documentListener).toHaveBeenCalledOnce();
    documentListener.mockClear();
    const page = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(page);
    expect(page.defaultPrevented).toBe(true);
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(documentListener).not.toHaveBeenCalled();
    const inside = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    inContainer.dispatchEvent(inside);
    expect(inside.defaultPrevented).toBe(true);
    expect(onDismiss).toHaveBeenCalledTimes(2);
    expect(documentListener).not.toHaveBeenCalled();
  });

  it('Tab cycles inside the root', () => {
    const { container, root } = setup();
    const first = document.createElement('button');
    const second = document.createElement('button');
    root.replaceChildren(first, second);
    open(container, root, root);
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
    root.replaceChildren(first);
    first.focus();
    const singleTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    first.dispatchEvent(singleTab);
    expect(document.activeElement).toBe(first);
    expect(singleTab.defaultPrevented).toBe(true);
    const singleShiftTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    first.dispatchEvent(singleShiftTab);
    expect(document.activeElement).toBe(first);
    expect(singleShiftTab.defaultPrevented).toBe(true);
  });

  it('a mousedown or pointerdown inside the root keeps focus unless it targets the text input', () => {
    const { container, root, input } = setup();
    const child = document.createElement('button');
    root.append(child);
    own(
      openDialogShell({
        container,
        root,
        initialFocus: input,
        textInput: input,
        onDismiss: vi.fn(),
        onKeyDown: vi.fn(),
      }),
    );
    const mouse = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    child.dispatchEvent(mouse);
    const pointer = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    child.dispatchEvent(pointer);
    const inputMouse = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    input.dispatchEvent(inputMouse);
    expect(mouse.defaultPrevented).toBe(true);
    expect(pointer.defaultPrevented).toBe(true);
    expect(inputMouse.defaultPrevented).toBe(false);
  });

  it('a pointerdown outside closes after the deferral and one inside does not', () => {
    vi.useFakeTimers();
    const { container, root, input } = setup();
    const { onDismiss } = open(container, root, input);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();
    vi.runAllTimers();
    root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('dispose removes attached pointer and capture-key listeners', () => {
    vi.useFakeTimers();
    const { container, root, input } = setup();
    const { onDismiss, dispose } = open(container, root, input);
    vi.runAllTimers();
    dispose();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(onDismiss).not.toHaveBeenCalled();
    const inContainer = document.createElement('div');
    container.append(inContainer);
    inContainer.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(onDismiss).not.toHaveBeenCalled();
    expect(root.isConnected).toBe(false);
  });

  it('disposing before the deferred listener runs cannot dismiss a new dialog from inside', () => {
    vi.useFakeTimers();
    const { container, root, input } = setup();
    const first = open(container, root, input);
    first.dispose();
    vi.runAllTimers();

    const nextRoot = document.createElement('div');
    const nextInput = document.createElement('input');
    nextRoot.append(nextInput);
    const second = open(container, nextRoot, nextInput);
    vi.runAllTimers();
    nextRoot.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(second.onDismiss).not.toHaveBeenCalled();
  });

  it('focusBoard refocuses from the dialog and preserves an outside control', () => {
    const { container, wrapper, root, input } = setup();
    container.append(root);
    input.focus();
    focusBoard(wrapper, root);
    expect(document.activeElement).toBe(wrapper);
    const outside = document.createElement('input');
    document.body.append(outside);
    outside.focus();
    focusBoard(wrapper, root);
    expect(document.activeElement).toBe(outside);
  });
});
