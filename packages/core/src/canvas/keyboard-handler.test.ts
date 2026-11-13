/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionRegistry } from '../actions/action-registry';
import type { ActionContext } from '../actions/types';
import { Camera } from './camera';
import { ClipboardBridge } from './clipboard-bridge';
import { KeyboardActions } from './keyboard-actions';
import { KeyboardHandler } from './keyboard-handler';
import { createNote } from '../elements/element-factory';
import { ElementStore } from '../elements/element-store';
import { HistoryRecorder } from '../history/history-recorder';
import { HistoryStack } from '../history/history-stack';
import { SelectTool } from '../tools/select-tool';
import { ToolManager } from '../tools/tool-manager';
import type { ToolContext } from '../tools/types';

const abortControllers = new Set<AbortController>();
const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');

afterEach(() => {
  for (const abort of abortControllers) abort.abort();
  abortControllers.clear();
  document.body.replaceChildren();
  if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
});

function setup(scope: 'focus' | 'window') {
  const element = document.createElement('div');
  element.tabIndex = 0;
  document.body.append(element);
  const actions = new ActionRegistry((): ActionContext => ({
    viewport: null as unknown as ActionContext['viewport'],
    store: null as unknown as ActionContext['store'],
    selectedIds: [],
  }));
  const calls = vi.fn();
  for (const [id, shortcut] of [
    ['test.enter', 'enter'],
    ['test.space', 'space'],
    ['test.delete', 'delete'],
    ['test.nudge-right', 'arrowright'],
    ['test.undo', 'mod+z'],
    ['test.tool', 'f'],
  ] as const) {
    actions.register({ id, label: id, shortcut: [shortcut], perform: calls });
  }
  const abort = new AbortController();
  abortControllers.add(abort);
  const keyboardActions = new KeyboardActions({
    getToolManager: () => null,
    getToolContext: () => null,
    getHistoryRecorder: () => null,
    getHistoryStack: () => null,
    isToolActive: () => false,
  });
  new KeyboardHandler({
    element,
    camera: new Camera(),
    keyboardActions,
    clipboard: new ClipboardBridge({ keyboardActions, document }),
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

function clipboardEvent(
  type: 'copy' | 'cut' | 'beforecopy' | 'beforecut',
  data: Record<string, string> = {},
) {
  const written: [string, string][] = [];
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (t: string) => data[t] ?? '',
      setData: (t: string, v: string) => {
        written.push([t, v]);
      },
      items: [],
      files: [],
      types: Object.keys(data),
    },
  });
  return { event: event as ClipboardEvent, written };
}

function setupBoard() {
  const element = document.createElement('div');
  element.tabIndex = 0;
  document.body.append(element);
  const store = new ElementStore();
  const stack = new HistoryStack();
  const recorder = new HistoryRecorder(store, stack);
  const select = new SelectTool();
  const toolManager = new ToolManager();
  toolManager.register(select);
  const ctx: ToolContext = {
    camera: new Camera(),
    store,
    requestRender: vi.fn(),
    requestOverlayRender: vi.fn(),
    switchTool: (name) => toolManager.setTool(name, ctx),
    setSelection: (ids) => select.setSelection(ids),
  };
  toolManager.setTool('select', ctx);
  const ka = new KeyboardActions({
    getToolManager: () => toolManager,
    getToolContext: () => ctx,
    getHistoryRecorder: () => recorder,
    getHistoryStack: () => stack,
    isToolActive: () => false,
  });
  const bridge = new ClipboardBridge({ keyboardActions: ka, document });
  const abort = new AbortController();
  abortControllers.add(abort);
  new KeyboardHandler({
    element,
    camera: ctx.camera,
    keyboardActions: ka,
    clipboard: bridge,
    actions: new ActionRegistry((): ActionContext => ({
      viewport: null as unknown as ActionContext['viewport'],
      store,
      selectedIds: select.selectedIds,
    })),
    scope: 'focus',
    abortSignal: abort.signal,
    getToolContext: () => ctx,
    getActiveTool: () => toolManager.activeTool,
    getLastPointerEvent: () => null,
    setSpaceHeld: vi.fn(),
    getActivePointerCount: () => 0,
    dispatchToolHover: vi.fn(),
    addImage: vi.fn(() => ''),
    getLastPointerWorld: () => null,
    getCenteredWorld: () => ({ x: 0, y: 0 }),
  });
  const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 }, text: 'hi' });
  store.add(note);
  select.setSelection([note.id]);
  element.focus();
  return { element, store, stack, select, ka, bridge };
}

function outsideInput() {
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  return input;
}

describe('KeyboardHandler clipboard', () => {
  it('copy writes the vendor, html and plain formats and claims the event', () => {
    const { element } = setupBoard();
    const { event, written } = clipboardEvent('copy');

    element.dispatchEvent(event);

    expect(written.map(([t]) => t)).toEqual(['fieldnotes/clipboard', 'text/html', 'text/plain']);
    expect(event.defaultPrevented).toBe(true);
    expect(JSON.parse(written[0]?.[1] ?? '{}').type).toBe('fieldnotes/clipboard');
  });

  it('cut deletes the selection exactly once in one undo step', () => {
    const { element, store, stack } = setupBoard();
    const before = store.count;
    const undoBefore = stack.undoCount;
    const { event, written } = clipboardEvent('cut');

    element.dispatchEvent(event);

    expect(store.count).toBe(before - 1);
    expect(stack.undoCount).toBe(undoBefore + 1);
    expect(written).toHaveLength(3);
  });

  it('a copy event from an outside input is left to the browser', () => {
    setupBoard();
    const input = outsideInput();
    const { event, written } = clipboardEvent('copy');

    input.dispatchEvent(event);

    expect(written).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('ClipboardBridge.copy writes through execCommand even when the target fails shouldHandle', () => {
    const { element, bridge } = setupBoard();
    const { event, written } = clipboardEvent('copy');
    document.execCommand = vi.fn(() => {
      window.dispatchEvent(event);
      return true;
    });
    element.blur();

    bridge.copy();

    expect(written.map(([t]) => t)).toEqual(['fieldnotes/clipboard', 'text/html', 'text/plain']);
    expect(bridge.pendingWrite).toBe(false);
  });

  it('a false execCommand keeps the memory clipboard', () => {
    const { ka, bridge } = setupBoard();
    const { written } = clipboardEvent('copy');
    document.execCommand = vi.fn(() => false);

    bridge.copy();

    expect(ka.hasClipboard()).toBe(true);
    expect(written).toEqual([]);
  });

  it('a missing execCommand keeps the memory clipboard', () => {
    const { ka, bridge } = setupBoard();
    delete (document as { execCommand?: unknown }).execCommand;

    expect(() => bridge.copy()).not.toThrow();
    expect(ka.hasClipboard()).toBe(true);
  });

  it('beforecopy is prevented only when the copy would be handled', () => {
    const { element, select } = setupBoard();
    const handled = clipboardEvent('beforecopy').event;
    element.dispatchEvent(handled);
    expect(handled.defaultPrevented).toBe(true);

    const fromInput = clipboardEvent('beforecut').event;
    outsideInput().dispatchEvent(fromInput);
    expect(fromInput.defaultPrevented).toBe(false);

    element.focus();
    select.setSelection([]);
    const empty = clipboardEvent('beforecopy').event;
    element.dispatchEvent(empty);
    expect(empty.defaultPrevented).toBe(false);
  });
});
