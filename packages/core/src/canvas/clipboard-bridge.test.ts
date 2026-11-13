/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Camera } from './camera';
import { ClipboardBridge } from './clipboard-bridge';
import { KeyboardActions } from './keyboard-actions';
import { createNote } from '../elements/element-factory';
import { ElementStore } from '../elements/element-store';
import { SelectTool } from '../tools/select-tool';
import { ToolManager } from '../tools/tool-manager';
import type { ToolContext } from '../tools/types';

const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');

afterEach(() => {
  if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
});

function setup() {
  const store = new ElementStore();
  const select = new SelectTool();
  const toolManager = new ToolManager();
  toolManager.register(select);
  const ctx: ToolContext = {
    camera: new Camera(),
    store,
    requestRender: vi.fn(),
    requestOverlayRender: vi.fn(),
  };
  toolManager.setTool('select', ctx);
  const ka = new KeyboardActions({
    getToolManager: () => toolManager,
    getToolContext: () => ctx,
    getHistoryRecorder: () => null,
    getHistoryStack: () => null,
    isToolActive: () => false,
  });
  const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
  store.add(note);
  select.setSelection([note.id]);
  return { store, ka, bridge: new ClipboardBridge({ keyboardActions: ka, document }) };
}

describe('ClipboardBridge', () => {
  it('cut runs execCommand copy, never cut, and deletes the selection', () => {
    const { store, bridge } = setup();
    const exec = vi.fn(() => false);
    document.execCommand = exec;

    bridge.cut();

    expect(exec.mock.calls).toEqual([['copy']]);
    expect(store.count).toBe(0);
  });

  it('copy skips execCommand when nothing is selected', () => {
    const { store, ka, bridge } = setup();
    for (const el of store.getAll()) store.remove(el.id);
    const exec = vi.fn(() => true);
    document.execCommand = exec;

    bridge.copy();

    expect(exec).not.toHaveBeenCalled();
    expect(ka.hasClipboard()).toBe(false);
  });

  it('handleCopy leaves an event without clipboardData to the browser', () => {
    const { ka, bridge } = setup();
    const event = new Event('copy', { cancelable: true }) as ClipboardEvent;

    expect(bridge.handleCopy(event, true, false)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(ka.hasClipboard()).toBe(false);
  });
});
