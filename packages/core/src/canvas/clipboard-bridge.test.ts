/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Camera } from './camera';
import { ClipboardBridge } from './clipboard-bridge';
import type { ClipboardHost } from './clipboard-bridge';
import { encodeClipboard, FIELDNOTES_CLIPBOARD_TYPE } from './clipboard-codec';
import { KeyboardActions } from './keyboard-actions';
import { getDefaultElementRegistry } from '../elements/default-registry';
import { createNote, createShape } from '../elements/element-factory';
import { ElementStore } from '../elements/element-store';
import { HistoryRecorder } from '../history/history-recorder';
import { HistoryStack } from '../history/history-stack';
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
  const stack = new HistoryStack();
  const recorder = new HistoryRecorder(store, stack);
  const ka = new KeyboardActions({
    getToolManager: () => toolManager,
    getToolContext: () => ctx,
    getHistoryRecorder: () => recorder,
    getHistoryStack: () => stack,
    isToolActive: () => false,
  });
  const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
  store.add(note);
  select.setSelection([note.id]);
  const host = {
    elementRegistry: getDefaultElementRegistry(),
    onPaste: undefined as ClipboardHost['onPaste'],
    claimsFile: vi.fn((file: File) => file.type.startsWith('image/')),
    insertElements: vi.fn(),
    insertFiles: vi.fn(() => true),
    insertText: vi.fn(),
  };
  const canInsertNow = vi.fn(() => true);
  const bridge = new ClipboardBridge({
    keyboardActions: ka,
    document,
    element: document.body,
    isDisabled: () => false,
    canInsertNow,
    host,
  });
  return { store, select, ka, host, canInsertNow, bridge };
}

interface PasteData {
  vendor?: string;
  html?: string;
  text?: string;
  files?: File[];
}

function pasteEvent({ vendor, html, text, files = [] }: PasteData = {}): ClipboardEvent {
  const formats: Record<string, string | undefined> = {
    [FIELDNOTES_CLIPBOARD_TYPE]: vendor,
    'text/html': html,
    'text/plain': text,
  };
  const event = new Event('paste', { cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (t: string) => formats[t] ?? '',
      items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
      files,
      types: [],
    },
  });
  return event as ClipboardEvent;
}

const anchor = { x: 40, y: 60 };
const noteA = createNote({
  position: { x: 0, y: 0 },
  size: { w: 80, h: 40 },
  index: 'a0',
  text: 'A',
});
const envelope = encodeClipboard([noteA]);
const png = new File([new Uint8Array([1])], 'pic.png', { type: 'image/png' });
const pdf = new File([new Uint8Array([1])], 'doc.pdf', { type: 'application/pdf' });
const aShaped = [expect.objectContaining({ type: 'note', text: 'A' })];

function hostCalls(host: ReturnType<typeof setup>['host']): number {
  return (
    host.insertElements.mock.calls.length +
    host.insertFiles.mock.calls.length +
    host.insertText.mock.calls.length
  );
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

describe('ClipboardBridge.paste', () => {
  it.each<[string, 'insertElements' | 'insertFiles' | 'insertText', PasteData, unknown[]]>([
    ['a vendor envelope', 'insertElements', { vendor: envelope.vendor }, [aShaped, anchor]],
    ['an html envelope', 'insertElements', { html: envelope.html }, [aShaped, anchor]],
    ['a plain-text envelope', 'insertElements', { text: envelope.vendor }, [aShaped, anchor]],
    [
      'an https URL',
      'insertText',
      { text: 'https://example.com' },
      ['https://example.com', anchor, 'https://example.com'],
    ],
    [
      'a padded www URL',
      'insertText',
      { text: ' www.example.com ' },
      ['www.example.com', anchor, 'https://www.example.com'],
    ],
    ['two lines', 'insertText', { text: 'hello\nworld' }, ['hello\nworld', anchor]],
    ['a number', 'insertText', { text: '3.14' }, ['3.14', anchor]],
    ['an image file', 'insertFiles', { files: [png] }, [[png], anchor, 'paste']],
  ])('%s goes to host.%s', (_, method, data, args) => {
    const { ka, host, bridge } = setup();
    const memory = vi.spyOn(ka, 'paste');

    bridge.paste(pasteEvent(data), anchor);

    expect(host[method].mock.calls).toEqual([args]);
    expect(hostCalls(host)).toBe(1);
    expect(memory).not.toHaveBeenCalled();
  });

  it.each<[string, PasteData]>([
    ['html without an envelope', { html: '<p>hi</p>' }],
    ['an empty clipboard', {}],
  ])('%s is a memory paste', (_, data) => {
    const { ka, host, bridge } = setup();
    const memory = vi.spyOn(ka, 'paste');

    bridge.paste(pasteEvent(data), anchor);

    expect(memory).toHaveBeenCalledOnce();
    expect(hostCalls(host)).toBe(0);
  });

  it('an event without clipboardData is a memory paste', () => {
    const { ka, host, bridge } = setup();
    const memory = vi.spyOn(ka, 'paste');

    bridge.paste(new Event('paste') as ClipboardEvent, anchor);

    expect(memory).toHaveBeenCalledOnce();
    expect(hostCalls(host)).toBe(0);
  });

  it('a present marker with a malformed envelope inserts nothing and never falls to the text rules', () => {
    const { ka, host, bridge } = setup();
    const memory = vi.spyOn(ka, 'paste');
    const vendor =
      '{"type":"fieldnotes/clipboard","version":1,"stateVersion":6,"elements":[{"type":"stroke"}]}';

    bridge.paste(pasteEvent({ vendor, text: 'https://example.com' }), anchor);

    expect(hostCalls(host)).toBe(0);
    expect(memory).not.toHaveBeenCalled();
  });

  it('vendor wins over html', () => {
    const { host, bridge } = setup();
    const noteB = createNote({
      position: { x: 0, y: 0 },
      size: { w: 80, h: 40 },
      index: 'a0',
      text: 'B',
    });

    bridge.paste(
      pasteEvent({ vendor: envelope.vendor, html: encodeClipboard([noteB]).html }),
      anchor,
    );

    expect(host.insertElements.mock.calls).toEqual([[aShaped, anchor]]);
  });

  it('onPaste returning false falls through; true or undefined ends the paste; it is called for an envelope and not when there is nothing to paste', () => {
    for (const [result, inserts] of [
      [false, 1],
      [true, 0],
      [undefined, 0],
    ] as const) {
      const { host, bridge } = setup();
      const onPaste = vi.fn(() => result);
      host.onPaste = onPaste;
      const event = pasteEvent({ vendor: envelope.vendor });

      bridge.paste(event, anchor);

      expect(onPaste.mock.calls).toEqual([[event, anchor]]);
      expect(host.insertElements).toHaveBeenCalledTimes(inserts);
    }
    const { ka, host, bridge } = setup();
    const onPaste = vi.fn(() => false);
    host.onPaste = onPaste;
    const memory = vi.spyOn(ka, 'paste');

    bridge.paste(pasteEvent({ html: '<p>hi</p>' }), anchor);

    expect(onPaste).not.toHaveBeenCalled();
    expect(memory).toHaveBeenCalledOnce();
  });

  it.each([
    ['true', 1, true],
    ['undefined', 1, undefined],
    ['false', 2, false],
  ] as const)(
    'onPaste returning %s before a memory paste leaves %i elements',
    (_, count, result) => {
      for (const event of [pasteEvent({}), new Event('paste') as ClipboardEvent]) {
        const { store, ka, host, bridge } = setup();
        ka.copy();
        const onPaste = vi.fn(() => result);
        host.onPaste = onPaste;

        bridge.paste(event, anchor);

        expect(onPaste.mock.calls).toEqual([[event, anchor]]);
        expect(store.count).toBe(count);
      }
    },
  );

  it('preventDefault is called when core handles and not on the memory fallback', () => {
    const { bridge } = setup();
    const handled = pasteEvent({ text: 'hello' });
    const memory = pasteEvent({});

    bridge.paste(handled, anchor);
    bridge.paste(memory, anchor);

    expect(handled.defaultPrevented).toBe(true);
    expect(memory.defaultPrevented).toBe(false);
  });

  it('a paste during a gesture or an open transaction is ignored', () => {
    const { ka, host, canInsertNow, bridge } = setup();
    canInsertNow.mockReturnValue(false);
    const memory = vi.spyOn(ka, 'paste');

    for (const data of [{ vendor: envelope.vendor }, { files: [png] }, { text: 'hello' }]) {
      bridge.paste(pasteEvent(data), anchor);
    }

    expect(canInsertNow).toHaveBeenCalledTimes(3);
    expect(hostCalls(host)).toBe(0);
    expect(memory).not.toHaveBeenCalled();
  });

  it("a URL paste never changes the selection's link", () => {
    const { store, select, host, bridge } = setup();
    const shape = createShape({ position: { x: 0, y: 0 }, size: { w: 50, h: 50 } });
    store.add(shape);
    select.setSelection([shape.id]);

    bridge.paste(pasteEvent({ text: 'https://example.com' }), anchor);

    expect(store.getById(shape.id)?.link).toBeUndefined();
    expect(host.insertText.mock.calls).toEqual([
      ['https://example.com', anchor, 'https://example.com'],
    ]);
  });

  it('a javascript: line is plain text with no link', () => {
    const { host, bridge } = setup();

    bridge.paste(pasteEvent({ text: 'javascript:alert(1)' }), anchor);

    expect(host.insertText.mock.calls).toEqual([['javascript:alert(1)', anchor]]);
  });

  it('a paste holding only an unclaimed file and no text is a memory paste', () => {
    const { ka, host, bridge } = setup();
    host.claimsFile.mockReturnValue(false);
    const memory = vi.spyOn(ka, 'paste');
    const event = pasteEvent({ files: [pdf] });

    bridge.paste(event, anchor);

    expect(memory).toHaveBeenCalledOnce();
    expect(hostCalls(host)).toBe(0);
    expect(event.defaultPrevented).toBe(false);
  });
});
