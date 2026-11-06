/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionRegistry } from '../actions/action-registry';
import { Camera } from './camera';
import { KeyboardActions } from './keyboard-actions';
import { KeyboardHandler } from './keyboard-handler';

const abortControllers = new Set<AbortController>();

afterEach(() => {
  for (const abort of abortControllers) abort.abort();
  abortControllers.clear();
  document.body.replaceChildren();
});

function setup(scope: 'focus' | 'window') {
  const element = document.createElement('div');
  element.tabIndex = 0;
  document.body.append(element);
  const actions = new ActionRegistry(() => ({}));
  const calls = vi.fn();
  for (const [id, shortcut] of [
    ['test.enter', 'enter'],
    ['test.space', 'space'],
    ['test.delete', 'delete'],
    ['test.nudge-right', 'arrowright'],
    ['test.undo', 'mod+z'],
    ['test.tool', 'f'],
  ]) {
    actions.register({ id, shortcut: [shortcut], perform: calls });
  }
  const abort = new AbortController();
  abortControllers.add(abort);
  new KeyboardHandler({
    element,
    camera: new Camera(),
    keyboardActions: new KeyboardActions({
      getToolManager: () => null,
      getToolContext: () => null,
      getHistoryRecorder: () => null,
      getHistoryStack: () => null,
      isToolActive: () => false,
    }),
    actions,
    scope,
    abortSignal: abort.signal,
    getToolContext: () => null,
    getActiveTool: () => null,
    getLastPointerEvent: () => null,
    setSpaceHeld: vi.fn(),
    getActivePointerCount: () => 0,
    dispatchToolHover: vi.fn(),
    addImage: vi.fn(() => ''),
    getLastPointerWorld: () => null,
    getCenteredWorld: () => ({ x: 0, y: 0 }),
  });
  return { abort, calls, element };
}

function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key, ...init }));
}

function liveControl(element: HTMLElement, tag: keyof HTMLElementTagNameMap) {
  const live = document.createElement('div');
  live.dataset.elementId = 'live';
  live.dataset.fnLive = '';
  const control = document.createElement(tag);
  live.append(control);
  element.append(live);
  return control;
}

describe.each(['focus', 'window'] as const)('KeyboardHandler (%s scope)', (scope) => {
  it.each([
    ['button', 'button'],
    ['link', 'a'],
    ['summary', 'summary'],
  ] as const)('keeps Enter and Space with a focused %s', (_, tag) => {
    const { abort, calls, element } = setup(scope);
    const control = document.createElement(tag);
    element.append(control);
    if (control instanceof HTMLAnchorElement) control.href = '#target';
    control.focus();

    press(control, 'Enter');
    press(control, ' ');

    expect(calls).not.toHaveBeenCalled();
    abort.abort();
  });

  it('keeps shortcuts and tool keys with a control inside live HTML', () => {
    const { abort, calls, element } = setup(scope);
    const control = liveControl(element, 'button');
    control.focus();

    press(control, 'Delete');
    press(control, 'ArrowRight');
    press(control, 'z', { ctrlKey: true });
    press(control, 'f');

    expect(calls).not.toHaveBeenCalled();
    abort.abort();
  });

  it('routes mod+z from a focused button outside live HTML', () => {
    const { abort, calls, element } = setup(scope);
    const button = document.createElement('button');
    element.append(button);
    button.focus();

    press(button, 'z', { ctrlKey: true });

    expect(calls).toHaveBeenCalledOnce();
    abort.abort();
  });
});
