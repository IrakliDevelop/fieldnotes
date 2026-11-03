/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNote, createText } from '../elements/element-factory';
import { createFrame } from '../elements/frame-element';
import { createViewportHarness } from '../test-helpers/viewport-harness';
import { Camera } from './camera';
import { CommandPalette, createPaletteActions } from './command-palette';
import { makeHost } from './__test-utils__/overlay-host';
import { DEFAULT_PALETTE_STRINGS } from './palette-model';
import { Viewport } from './viewport';
import type { CommandPaletteDeps } from './command-palette';
import { recordingCanvas } from '../test-helpers/recording-canvas';
import type { BaseElement, ElementTypeDefinition } from '../elements/types';

const cleanup: (() => void)[] = [];

interface GhostElement extends BaseElement {
  type: 'ghost';
}

const ghostDefinition: ElementTypeDefinition<GhostElement> = {
  type: 'test:ghost',
  legacyTypes: [],
  decodeLegacy: () => ({
    id: 'ghost',
    type: 'ghost',
    position: { x: 0, y: 0 },
    index: 'a0',
    version: 1,
    locked: false,
    layerId: 'default',
  }),
  validateData: () => true,
  unwrap: (element) => ({
    id: element.id,
    type: 'ghost',
    position: element.position,
    index: element.index,
    version: element.version,
    locked: element.locked,
    layerId: element.layerId,
  }),
  wrap: (element) => ({
    id: element.id,
    type: 'extension',
    extensionType: 'test:ghost',
    position: element.position,
    index: element.index,
    version: element.version,
    locked: element.locked,
    layerId: element.layerId,
    data: {},
  }),
  bounds: () => null,
  searchText: () => 'Ghost ping',
};

function makeDeps(overrides: Partial<CommandPaletteDeps> = {}) {
  const harness = createViewportHarness();
  cleanup.push(() => harness.cleanup());
  const container = document.createElement('div');
  const wrapper = document.createElement('div');
  wrapper.tabIndex = 0;
  document.body.append(container, wrapper);
  cleanup.push(() => container.remove());
  cleanup.push(() => wrapper.remove());
  const calls = { context: vi.fn(), help: vi.fn(), stop: vi.fn() };
  const deps: CommandPaletteDeps = {
    container,
    wrapper,
    actions: harness.viewport.actions,
    getActionContext: () => ({
      viewport: harness.viewport,
      store: harness.viewport.store,
      selectedIds: [],
    }),
    getBindings: () => harness.viewport.shortcuts.getBindings(),
    store: harness.viewport.store,
    registry: harness.viewport.elementRegistry,
    isLayerVisible: () => true,
    camera: new Camera(),
    getCanvasSize: () => ({ w: 800, h: 600 }),
    overlayHost: { registerOverlay: () => () => undefined, requestRender: () => undefined },
    stopCameraMotion: calls.stop,
    closeContextMenu: calls.context,
    help: { open: () => undefined, close: calls.help, isOpen: () => false },
    matchShortcut: (event) => (event.ctrlKey && event.key === 'k' ? 'palette.open' : null),
    selectionColor: '#2196F3',
    isMac: () => false,
    strings: DEFAULT_PALETTE_STRINGS,
    ...overrides,
  };
  const palette = new CommandPalette(deps);
  cleanup.push(() => palette.destroy());
  return { harness, container, wrapper, palette, calls, deps };
}

function addAction(
  harness: ReturnType<typeof createViewportHarness>,
  id: string,
  label: string,
  perform = vi.fn(),
) {
  const remove = harness.viewport.actions.register({ id, label, perform });
  cleanup.push(remove);
  return perform;
}

function rows(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('[role="option"]')];
}

function active(container: HTMLElement) {
  const row = container.querySelector<HTMLElement>('.fieldnotes-palette-option--active');
  if (!row) throw new Error('missing active row');
  return row;
}

function input(container: HTMLElement) {
  const field = container.querySelector<HTMLInputElement>('[role="combobox"]');
  if (!field) throw new Error('missing input');
  return field;
}

function type(container: HTMLElement, value: string) {
  const field = input(container);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  return field;
}

function key(target: HTMLElement, value: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: value,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
}

function addHit(
  harness: ReturnType<typeof createViewportHarness>,
  kind: 'note' | 'text' | 'frame',
  text: string,
  id: string,
) {
  if (kind === 'note') {
    harness.viewport.store.add({ ...createNote({ position: { x: 0, y: 0 }, text }), id });
    return;
  }
  if (kind === 'text') {
    harness.viewport.store.add({ ...createText({ position: { x: 0, y: 0 }, text }), id });
    return;
  }
  harness.viewport.store.add({
    ...createFrame({ position: { x: 0, y: 0 }, size: { w: 100, h: 80 }, title: text }),
    id,
  });
}

afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
  vi.useRealTimers();
  document.body.replaceChildren();
  document.head
    .querySelectorAll('style[data-fieldnotes-palette]')
    .forEach((style) => style.remove());
  vi.unstubAllGlobals();
});

describe('command palette', () => {
  it('keeps the palette open when an action label throws', () => {
    const { harness, container, palette } = makeDeps();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('label bug');
    const remove = harness.viewport.actions.register({
      id: 'test.bad-label',
      label: () => {
        throw error;
      },
      perform: () => undefined,
    });
    cleanup.push(remove);

    palette.open();

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(palette.isOpen()).toBe(true);
    expect(
      rows(container).find((row) => row.dataset.key === 'test.bad-label')?.textContent,
    ).toContain('test.bad-label');
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(
      '[fieldnotes] action label() failed for "test.bad-label"',
      error,
    );
    errorSpy.mockRestore();
  });

  it('open mounts the palette, focuses the input and lists enabled actions', () => {
    const { harness, container, palette, calls } = makeDeps();
    addAction(harness, 'test.ping', 'Ping test');
    palette.open();
    const field = input(container);
    const list = container.querySelector<HTMLElement>('[role="listbox"]');
    const group = container.querySelector<HTMLElement>('[role="group"]');
    const title = container.querySelector<HTMLElement>('.fieldnotes-palette-group-title');
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-label')).toBe('Search actions and the board');
    expect(field.getAttribute('aria-expanded')).toBe('true');
    expect(field.getAttribute('aria-autocomplete')).toBe('list');
    expect(field.getAttribute('autocomplete')).toBe('off');
    expect(field.spellcheck).toBe(false);
    expect(field.getAttribute('aria-controls')).toBe(list?.id);
    expect(field.placeholder).toBe('Search actions and the board');
    expect(document.activeElement).toBe(field);
    expect(rows(container).map((row) => row.textContent)).toEqual(
      expect.arrayContaining(['UndoCtrl+Z', 'Present', 'Ping test']),
    );
    expect(rows(container).some((row) => row.dataset.key === 'palette.open')).toBe(false);
    expect(rows(container).some((row) => row.textContent?.includes('Delete'))).toBe(false);
    expect(group?.getAttribute('aria-labelledby')).toBe(title?.id);
    expect(title?.getAttribute('role')).toBe('presentation');
    expect(active(container).getAttribute('aria-selected')).toBe('true');
    expect(field.getAttribute('aria-activedescendant')).toBe(active(container).id);
    expect(container.querySelector('.fieldnotes-palette-status')?.getAttribute('aria-live')).toBe(
      'polite',
    );
    expect(container.querySelector('.fieldnotes-palette-status')?.textContent).toBe(
      `Results: ${rows(container).length}`,
    );
    expect(calls.context).toHaveBeenCalledOnce();
    expect(calls.help).toHaveBeenCalledOnce();
  });

  it('strings override the placeholder, group headings, and result count label', () => {
    const strings = {
      ...DEFAULT_PALETTE_STRINGS,
      placeholder: 'Suche',
      actions: 'Befehle',
      board: 'Treffer',
      results: '{count} Treffer',
    };
    const { harness, container, palette } = makeDeps({ strings });
    addAction(harness, 'test.budget', 'Budget command');
    addHit(harness, 'note', 'Budget note', 'budget');
    addHit(harness, 'text', 'Budget text', 'budget-text');
    palette.open('bud');
    expect(input(container).placeholder).toBe('Suche');
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Suche');
    expect(container.textContent).toContain('Befehle');
    expect(container.textContent).toContain('Treffer');
    expect(container.querySelector('.fieldnotes-palette-status')?.textContent).toBe('3 Treffer');
  });

  it('typing filters actions and adds board hits under the second group', () => {
    const { harness, container, palette } = makeDeps();
    addHit(harness, 'note', 'Budget note', 'budget');
    addHit(harness, 'text', 'Shopping text', 'shopping');
    addHit(harness, 'frame', 'Roadmap frame', 'roadmap');
    palette.open();
    type(container, 'bud');
    expect(container.querySelectorAll('[role="group"]')).toHaveLength(1);
    expect(container.textContent).toContain('On the board');
    expect(rows(container)).toHaveLength(1);
    expect(rows(container)[0]?.textContent).toContain('Budget note');
    expect(container.querySelector('mark')?.textContent).toBe('Bud');
    expect(container.querySelector('.fieldnotes-palette-badge')?.textContent).toBe('Note');
    type(container, 'present');
    expect(rows(container)).toHaveLength(1);
    expect(rows(container)[0]?.textContent).toContain('Present');
    expect(container.textContent).not.toContain('On the board');
    expect(container.querySelector('.fieldnotes-palette-status')?.textContent).toBe('Results: 1');
    type(container, 'zzz');
    expect(container.querySelector('.fieldnotes-palette-empty')?.textContent).toBe(
      'No matches. Try a shorter search.',
    );
    expect(container.querySelector('.fieldnotes-palette-status')?.textContent).toBe(
      'No matches. Try a shorter search.',
    );
    expect(input(container).hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('a hit built from hostile text renders as text', () => {
    const { harness, container, palette } = makeDeps();
    addHit(harness, 'note', '&lt;img src=x onerror=alert(1)&gt;', 'hostile');
    palette.open('img');
    expect(rows(container)[0]?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.querySelector('img')).toBeNull();
  });

  it('a multiline hit marks source offsets relative to the displayed line', () => {
    const { harness, container, palette } = makeDeps();
    addHit(harness, 'note', '\n  \nBudget note', 'multiline');
    palette.open('bud');
    expect(rows(container)[0]?.textContent).toContain('Budget note');
    expect(container.querySelector('mark')?.textContent).toBe('Bud');
  });

  it('renders the matching line from a multiline board hit', () => {
    const { harness, container, palette } = makeDeps();
    addHit(harness, 'note', 'Title<br>budget plan', 'multiline-match');

    palette.open('budget');

    expect(container.querySelector('mark')?.textContent).toBe('budget');
  });

  it('keeps an emoji whole when excerpting a later match on a long line', () => {
    const { harness, container, palette } = makeDeps();
    const text = `${'a'.repeat(40)}😀${'b'.repeat(39)}budget trailing`;
    addHit(harness, 'note', text, 'unicode-excerpt');

    palette.open('budget');

    const excerpt = rows(container)[0]?.textContent ?? '';
    expect(container.querySelector('mark')?.textContent).toBe('budget');
    expect(excerpt.startsWith('…😀')).toBe(true);
    expect(excerpt).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u,
    );
  });

  it('ArrowDown and ArrowUp move the active row without wrapping and keep the caret keys', () => {
    const { harness, container, palette } = makeDeps();
    addAction(harness, 'test.q1', 'Q1');
    addAction(harness, 'test.q2', 'Q2');
    addAction(harness, 'test.q3', 'Q3');
    palette.open('q');
    const field = input(container);
    expect(rows(container).map((row) => row.textContent)).toEqual(['Q1', 'Q2', 'Q3']);
    expect(key(field, 'ArrowDown').defaultPrevented).toBe(true);
    expect(active(container).textContent).toBe('Q2');
    key(field, 'ArrowDown');
    key(field, 'ArrowDown');
    expect(active(container).textContent).toBe('Q3');
    key(field, 'ArrowUp');
    key(field, 'ArrowUp');
    key(field, 'ArrowUp');
    expect(active(container).textContent).toBe('Q1');
    expect(key(field, 'Home').defaultPrevented).toBe(false);
  });

  it('a mousedown on a group title is prevented and a modified palette.open key inside the input is swallowed', () => {
    const { harness, container, palette } = makeDeps();
    addAction(harness, 'test.ping', 'Ping test');
    palette.open();
    const field = input(container);
    const title = container.querySelector<HTMLElement>('.fieldnotes-palette-group-title');
    if (!title) throw new Error('missing title');
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    title.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field);
    expect(key(field, 'k', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(rows(container).some((row) => row.textContent?.includes('Ping test'))).toBe(true);
    palette.destroy();
    const plain = makeDeps({
      matchShortcut: (event) => (event.key === 'k' ? 'palette.open' : null),
    });
    plain.palette.open();
    expect(key(input(plain.container), 'k').defaultPrevented).toBe(false);
  });

  it('Enter runs the active action after closing and focuses the wrapper', () => {
    const { harness, container, wrapper, palette } = makeDeps();
    const ping = vi.fn(() => expect(palette.isOpen()).toBe(false));
    addAction(harness, 'test.ping', 'Ping test', ping);
    palette.open('ping');
    key(input(container), 'Enter');
    expect(ping).toHaveBeenCalledWith(expect.anything(), { source: 'menu', shiftKey: false });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(wrapper);
  });

  it('a click on a row runs it and a pointerdown on the list keeps the input focused', () => {
    const { harness, container, palette } = makeDeps();
    const ping = addAction(harness, 'test.ping', 'Ping test');
    palette.open('ping');
    const field = input(container);
    const list = container.querySelector<HTMLElement>('[role="listbox"]');
    if (!list) throw new Error('missing list');
    const down = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    list.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field);
    rows(container)[0]?.click();
    expect(ping).toHaveBeenCalledOnce();
    expect(palette.isOpen()).toBe(false);
  });

  it('keeps an unchanged action row through a store update until its click commits', async () => {
    const { harness, container, palette } = makeDeps();
    const ping = addAction(harness, 'test.ping', 'Ping test');
    palette.open('ping');
    const row = rows(container)[0];
    if (!row) throw new Error('missing action row');
    row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));

    addHit(harness, 'note', 'Unrelated note', 'unrelated');
    await Promise.resolve();

    expect(row.isConnected).toBe(true);
    expect(rows(container)).toContain(row);
    row.click();
    expect(ping).toHaveBeenCalledOnce();
    expect(palette.isOpen()).toBe(false);
  });

  it('does not scroll when a store update leaves rows and the active key unchanged', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    cleanup.push(() => {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    });
    const { harness, palette } = makeDeps();
    addAction(harness, 'test.ping', 'Ping test');
    palette.open('ping');
    scrollIntoView.mockClear();

    addHit(harness, 'note', 'Unrelated note', 'unrelated');
    await Promise.resolve();

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('scrolls the newly active row when ArrowDown changes selection', () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    cleanup.push(() => {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    });
    const { harness, container, palette } = makeDeps();
    addAction(harness, 'test.q1', 'Q1');
    addAction(harness, 'test.q2', 'Q2');
    addAction(harness, 'test.q3', 'Q3');

    palette.open('q');
    scrollIntoView.mockClear();
    key(input(container), 'ArrowDown');

    expect(active(container).textContent).toBe('Q2');
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('scrolls an active row that survives a re-filter at a new index', () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    cleanup.push(() => {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    });
    const { harness, container, palette } = makeDeps();
    addAction(harness, 'test.q1', 'Q1');
    addAction(harness, 'test.q2', 'Q2');
    addAction(harness, 'test.q3', 'Q3');

    palette.open('q');
    key(input(container), 'ArrowDown');
    scrollIntoView.mockClear();
    type(container, 'q2');

    expect(active(container).textContent).toBe('Q2');
    expect(rows(container)).toHaveLength(1);
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('scrolls the initial active row again after closing and reopening', () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    cleanup.push(() => {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    });
    const { harness, palette } = makeDeps();
    addAction(harness, 'test.q1', 'Q1');

    palette.open('q');
    scrollIntoView.mockClear();
    palette.close();
    palette.open('q');

    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('keeps a palette row open through a pointerdown in a closed shadow root before its click commits', () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'closed' });
    const container = document.createElement('div');
    shadow.append(container);
    document.body.append(host);
    const viewport = new Viewport(container);
    cleanup.push(() => viewport.destroy());
    const perform = vi.fn();
    const remove = viewport.actions.register({ id: 'test.ping', label: 'Ping test', perform });
    cleanup.push(remove);
    viewport.palette.open('ping');
    vi.advanceTimersByTime(0);
    const row = container.querySelector<HTMLElement>('[role="option"]');
    if (!row) throw new Error('missing palette row');
    row.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true }),
    );
    expect(viewport.palette.isOpen()).toBe(true);
    row.click();
    expect(perform).toHaveBeenCalledOnce();
    expect(viewport.palette.isOpen()).toBe(false);
    viewport.palette.open('ping');
    vi.advanceTimersByTime(0);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(viewport.palette.isOpen()).toBe(false);
  });

  it('an element row commits and closes without running an action', () => {
    const { harness, container, palette, deps } = makeDeps();
    const ping = addAction(harness, 'test.budget', 'Budget action');
    addHit(harness, 'note', 'Budget note', 'budget');
    const position = deps.camera.position;
    const zoom = deps.camera.zoom;
    palette.open('budget');
    const element = rows(container).find((row) => row.dataset.key === 'budget');
    if (!element) throw new Error('missing board row');
    element.click();
    expect(palette.isOpen()).toBe(false);
    expect(ping).not.toHaveBeenCalled();
    expect(deps.camera.position).toEqual(position);
    expect(deps.camera.zoom).toBe(zoom);
  });

  it('a store change while open re-renders and keeps the active key', async () => {
    const { harness, container, palette } = makeDeps();
    addHit(harness, 'note', 'Zebra a', 'a');
    addHit(harness, 'note', 'Zebra b', 'b');
    addHit(harness, 'note', 'Zebra c', 'c');
    palette.open('zebra');
    key(input(container), 'ArrowDown');
    expect(active(container).dataset.key).toBe('b');
    addHit(harness, 'note', 'Zebra d', 'd');
    await Promise.resolve();
    expect(rows(container)).toHaveLength(4);
    expect(active(container).dataset.key).toBe('b');
    harness.viewport.store.remove('b');
    await Promise.resolve();
    expect(rows(container)).toHaveLength(3);
    expect(active(container).dataset.key).toBe('a');
  });

  it('an action registry change while open re-renders', async () => {
    const { harness, container, palette } = makeDeps();
    palette.open();
    const remove = harness.viewport.actions.register({
      id: 'test.zoom',
      label: 'Zoom test',
      perform: () => undefined,
    });
    cleanup.push(remove);
    await Promise.resolve();
    expect(rows(container).some((row) => row.textContent === 'Zoom test')).toBe(true);
    remove();
    await Promise.resolve();
    expect(rows(container).some((row) => row.textContent === 'Zoom test')).toBe(false);
  });

  it('typing never moves the camera', () => {
    const { harness, container, palette, deps } = makeDeps();
    addHit(harness, 'note', 'Budget note', 'budget');
    deps.camera.moveTo(17, 23);
    deps.camera.setZoom(1.7);
    palette.open();
    type(container, 'bud');
    expect(rows(container)).toHaveLength(1);
    expect(rows(container)[0]?.dataset.key).toBe('budget');
    expect(active(container).dataset.key).toBe('budget');
    expect(deps.camera.position).toEqual({ x: 17, y: 23 });
    expect(deps.camera.zoom).toBe(1.7);
    expect(deps.stopCameraMotion).not.toHaveBeenCalled();
  });

  it('Escape closes, is prevented, and keys inside never reach document or window listeners', () => {
    const seen = { document: vi.fn(), window: vi.fn() };
    document.addEventListener('keydown', seen.document);
    window.addEventListener('keydown', seen.window);
    cleanup.push(() => document.removeEventListener('keydown', seen.document));
    cleanup.push(() => window.removeEventListener('keydown', seen.window));
    const { container, palette } = makeDeps();
    palette.open();
    const field = input(container);
    key(field, 'a');
    const escape = key(field, 'Escape');
    expect(escape.defaultPrevented).toBe(true);
    expect(palette.isOpen()).toBe(false);
    expect(seen.document).not.toHaveBeenCalled();
    expect(seen.window).not.toHaveBeenCalled();
  });

  it('an outside pointerdown closes after the deferral', () => {
    vi.useFakeTimers();
    const { container, palette } = makeDeps();
    const host = document.createElement('button');
    document.body.append(host);
    cleanup.push(() => host.remove());
    host.addEventListener('pointerdown', () => palette.open());
    host.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(palette.isOpen()).toBe(true);
    vi.advanceTimersByTime(0);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(palette.isOpen()).toBe(false);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('open with a query prefills and re-open replaces it and refocuses the input', () => {
    const { harness, container, palette } = makeDeps();
    addHit(harness, 'note', 'Budget note', 'budget');
    addHit(harness, 'note', 'Roadmap note', 'roadmap');
    palette.open('bud');
    expect(input(container).value).toBe('bud');
    expect(rows(container)[0]?.textContent).toContain('Budget');
    const outside = document.createElement('input');
    document.body.append(outside);
    cleanup.push(() => outside.remove());
    outside.focus();
    palette.open('road');
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(input(container).value).toBe('road');
    expect(document.activeElement).toBe(input(container));
    expect(rows(container)[0]?.textContent).toContain('Roadmap');
  });

  it('close preserves focus moved to an outside input', () => {
    const { palette } = makeDeps();
    const outside = document.createElement('input');
    document.body.append(outside);
    cleanup.push(() => outside.remove());
    palette.open();
    outside.focus();

    palette.close();

    expect(document.activeElement).toBe(outside);
  });

  it('destroy removes the root and the subscriptions', async () => {
    const { harness, container, wrapper, palette } = makeDeps();
    const render = vi.spyOn(Object.getPrototypeOf(palette), 'render');
    cleanup.push(() => render.mockRestore());
    palette.open();
    expect(document.activeElement).toBe(input(container));
    addHit(harness, 'note', 'Queued before destroy', 'queued');
    const removeQueued = harness.viewport.actions.register({
      id: 'test.queued',
      label: 'Queued',
      perform: () => undefined,
    });
    cleanup.push(removeQueued);
    palette.destroy();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).not.toBe(wrapper);
    addHit(harness, 'note', 'After destroy', 'after');
    const remove = harness.viewport.actions.register({
      id: 'test.after',
      label: 'After',
      perform: () => undefined,
    });
    cleanup.push(remove);
    await Promise.resolve();
    expect(render).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.children).toHaveLength(0);
    expect(document.activeElement).not.toBe(wrapper);
  });

  it('the stylesheet is appended once for two palettes', () => {
    const first = makeDeps();
    const second = makeDeps();
    first.palette.open();
    second.palette.open();
    expect(document.head.querySelectorAll('style[data-fieldnotes-palette]')).toHaveLength(1);
  });

  it('translated headings and colliding action/element ids remain unique', () => {
    const strings = { ...DEFAULT_PALETTE_STRINGS, actions: 'Same', board: 'Same' };
    const { harness, container, palette } = makeDeps({ strings });
    addAction(harness, 'shared', 'Budget command');
    addHit(harness, 'note', 'Budget note', 'shared');
    palette.open('budget');
    const headings = [
      ...container.querySelectorAll<HTMLElement>('.fieldnotes-palette-group-title'),
    ];
    const options = rows(container);
    expect(new Set(headings.map((heading) => heading.id)).size).toBe(2);
    expect(new Set(options.map((option) => option.id)).size).toBe(2);
    expect(options.map((option) => option.dataset.key)).toEqual(['shared', 'shared']);
    const before = input(container).getAttribute('aria-activedescendant');
    key(input(container), 'ArrowDown');
    expect(input(container).getAttribute('aria-activedescendant')).not.toBe(before);
  });

  it('an enabled palette.open action is still excluded by id', () => {
    const { harness, container, palette } = makeDeps();
    addAction(harness, 'test.control', 'Visible control');
    expect(harness.viewport.actions.isEnabled('palette.open')).toBe(true);
    expect(harness.viewport.palette.isOpen()).toBe(false);
    palette.open();
    expect(rows(container).some((row) => row.dataset.key === 'test.control')).toBe(true);
    expect(rows(container).some((row) => row.dataset.key === 'palette.open')).toBe(false);
  });

  it('createPaletteActions returns the exact definitions and behavior', () => {
    const fixture = makeDeps();
    const palette = { open: vi.fn(), close: vi.fn(), isOpen: vi.fn(() => false) };
    const help = { open: vi.fn(), close: vi.fn(), isOpen: vi.fn(() => false) };
    const definitions = createPaletteActions(palette, help);
    expect(definitions.map((definition) => definition.id)).toEqual([
      'palette.open',
      'palette.help',
    ]);
    const open = definitions[0];
    const shortcuts = definitions[1];
    if (!open || !shortcuts) throw new Error('missing palette definitions');
    expect({
      label: open.label,
      keywords: open.keywords,
      shortcut: open.shortcut,
      allowShift: open.allowShift,
      menu: open.menu,
    }).toEqual({
      label: 'Command palette',
      keywords: ['search', 'find', 'commands', 'go to'],
      shortcut: ['mod+k'],
      allowShift: undefined,
      menu: undefined,
    });
    expect({
      label: shortcuts.label,
      keywords: shortcuts.keywords,
      shortcut: shortcuts.shortcut,
      allowShift: shortcuts.allowShift,
      menu: shortcuts.menu,
    }).toEqual({
      label: 'Keyboard shortcuts',
      keywords: ['help', 'keys', 'bindings', 'shortcuts'],
      shortcut: ['?'],
      allowShift: true,
      menu: undefined,
    });
    const context = fixture.deps.getActionContext();
    expect(open.enabled?.(context)).toBe(true);
    palette.isOpen.mockReturnValue(true);
    expect(open.enabled?.(context)).toBe(false);
    expect(shortcuts.enabled?.(context)).toBe(true);
    help.isOpen.mockReturnValue(true);
    expect(shortcuts.enabled?.(context)).toBe(false);
    expect(open.perform(context, { source: 'keyboard', shiftKey: false })).toBeUndefined();
    expect(shortcuts.perform(context, { source: 'keyboard', shiftKey: false })).toBeUndefined();
    expect(palette.open).toHaveBeenCalledOnce();
    expect(help.open).toHaveBeenCalledOnce();
  });
});

describe('CommandPalette reveal', () => {
  it('ArrowDown onto an element row animates the camera and highlights it', () => {
    let clock = 0;
    let pending: (() => void)[] = [];
    const overlay = makeHost();
    const fixture = makeDeps({
      overlayHost: overlay.host,
      frames: {
        requestFrame: (callback) => {
          pending.push(callback);
          return pending.length;
        },
        cancelFrame: () => undefined,
      },
      now: () => clock,
    });
    addAction(fixture.harness, 'test.ping', 'Ping test');
    fixture.harness.viewport.store.add({
      ...createNote({ position: { x: 100, y: 100 }, size: { w: 50, h: 20 }, text: 'Budget ping' }),
      id: 'budget',
    });
    fixture.palette.open('ping');
    key(input(fixture.container), 'ArrowDown');
    clock = 450;
    const frames = pending;
    pending = [];
    for (const frame of frames) frame();
    const canvas = recordingCanvas();
    overlay.getRenderer()?.(canvas.ctx);
    expect(rows(fixture.container).map((row) => row.textContent)).toEqual([
      'Ping test',
      'Budget pingNote',
    ]);
    expect(fixture.deps.camera.position).toEqual({ x: 275, y: 190 });
    expect(fixture.deps.camera.zoom).toBe(1);
    expect(fixture.calls.stop).toHaveBeenCalledOnce();
    expect(canvas.strokes).toEqual([{ style: '#2196F3', alpha: 1 }]);
  });

  it('reduced motion jumps synchronously', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const fixture = makeDeps();
    addAction(fixture.harness, 'test.ping', 'Ping test');
    fixture.harness.viewport.store.add({
      ...createNote({ position: { x: 100, y: 100 }, size: { w: 50, h: 20 }, text: 'Budget ping' }),
      id: 'budget',
    });
    fixture.palette.open('ping');
    key(input(fixture.container), 'ArrowDown');
    expect(fixture.deps.camera.position).toEqual({ x: 275, y: 190 });
    expect(fixture.calls.stop).toHaveBeenCalledOnce();
  });

  it('re-opening while open resamples reduced motion', () => {
    let reducedMotion = false;
    const media = vi.fn(() => ({ matches: reducedMotion }));
    vi.stubGlobal('matchMedia', media);
    const fixture = makeDeps();
    addAction(fixture.harness, 'test.ping', 'Ping test');
    fixture.harness.viewport.store.add({
      ...createNote({ position: { x: 100, y: 100 }, size: { w: 50, h: 20 }, text: 'Budget ping' }),
      id: 'budget',
    });
    fixture.palette.open('ping');
    reducedMotion = true;
    fixture.palette.open('ping');
    key(input(fixture.container), 'ArrowDown');
    expect(fixture.deps.camera.position).toEqual({ x: 275, y: 190 });
    expect(media).toHaveBeenCalledTimes(2);
  });

  it('ArrowUp back onto an action row removes the highlight and does not move the camera again', () => {
    const overlay = makeHost();
    const fixture = makeDeps({ overlayHost: overlay.host });
    addAction(fixture.harness, 'test.ping', 'Ping test');
    addHit(fixture.harness, 'note', 'Budget ping', 'budget');
    fixture.palette.open('ping');
    key(input(fixture.container), 'ArrowDown');
    key(input(fixture.container), 'ArrowUp');
    const canvas = recordingCanvas();
    overlay.getRenderer()?.(canvas.ctx);
    expect(active(fixture.container).textContent).toBe('Ping test');
    expect(canvas.strokes).toEqual([]);
    expect(fixture.calls.stop).toHaveBeenCalledOnce();
  });

  it('Enter on an element reveals, lingers the highlight, and closes', () => {
    let clock = 0;
    const animatorFrames: (() => void)[] = [];
    const overlayFrames: (() => void)[] = [];
    const overlay = makeHost();
    const fixture = makeDeps({
      overlayHost: overlay.host,
      frames: {
        requestFrame: (callback) => {
          animatorFrames.push(callback);
          return animatorFrames.length;
        },
        cancelFrame: () => undefined,
      },
      now: () => clock,
    });
    fixture.harness.viewport.store.add({
      ...createNote({ position: { x: 100, y: 100 }, size: { w: 50, h: 20 }, text: 'Budget ping' }),
      id: 'budget',
    });
    fixture.palette.open('budget');
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      overlayFrames.push(callback);
      return overlayFrames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    key(input(fixture.container), 'Enter');
    expect(fixture.calls.stop).toHaveBeenCalledOnce();
    clock = 450;
    const frames = [...animatorFrames];
    for (const frame of frames) frame();
    const canvas = recordingCanvas();
    overlay.getRenderer()?.(canvas.ctx);
    expect(fixture.palette.isOpen()).toBe(false);
    expect(fixture.deps.camera.position).toEqual({ x: 275, y: 190 });
    expect(fixture.deps.camera.zoom).toBe(1);
    expect(canvas.strokes).toEqual([{ style: '#2196F3', alpha: 1 }]);
    clock = 1901;
    const overlayFrame = overlayFrames[0];
    if (!overlayFrame) throw new Error('missing overlay frame');
    overlayFrame();
    const faded = recordingCanvas();
    overlay.getRenderer()?.(faded.ctx);
    expect(faded.strokes).toEqual([]);
  });

  it('a vanished element drops the highlight on re-render', async () => {
    const overlay = makeHost();
    const fixture = makeDeps({ overlayHost: overlay.host });
    addAction(fixture.harness, 'test.ping', 'Ping test');
    addHit(fixture.harness, 'note', 'Budget ping', 'budget');
    fixture.palette.open('ping');
    key(input(fixture.container), 'ArrowDown');
    fixture.harness.viewport.store.remove('budget');
    await Promise.resolve();
    const canvas = recordingCanvas();
    overlay.getRenderer()?.(canvas.ctx);
    expect(rows(fixture.container).map((row) => row.dataset.key)).toEqual(['test.ping']);
    expect(canvas.strokes).toEqual([]);
  });

  it('an element without bounds is skipped', () => {
    const overlay = makeHost();
    const fixture = makeDeps({ overlayHost: overlay.host });
    fixture.harness.viewport.elementRegistry.register(ghostDefinition);
    addAction(fixture.harness, 'test.ping', 'Ping test');
    const ghost: GhostElement = {
      id: 'ghost',
      type: 'ghost',
      position: { x: 0, y: 0 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId: 'default',
    };
    fixture.harness.viewport.store.add(ghostDefinition.wrap(ghost));
    fixture.palette.open('ping');
    key(input(fixture.container), 'ArrowDown');
    const canvas = recordingCanvas();
    overlay.getRenderer()?.(canvas.ctx);
    expect(rows(fixture.container).map((row) => row.textContent)).toEqual([
      'Ping test',
      'Ghost pingtest:ghost',
    ]);
    expect(fixture.deps.camera.position).toEqual({ x: 0, y: 0 });
    expect(fixture.calls.stop).not.toHaveBeenCalled();
    expect(canvas.strokes).toEqual([]);
  });

  it('reveal zooms out for an element larger than the view', () => {
    let clock = 0;
    const pending: (() => void)[] = [];
    const fixture = makeDeps({
      frames: {
        requestFrame: (callback) => (pending.push(callback), pending.length),
        cancelFrame: () => undefined,
      },
      now: () => clock,
    });
    addHit(fixture.harness, 'note', 'Wide ping', 'wide');
    fixture.harness.viewport.store.update('wide', { size: { w: 2000, h: 100 } });
    fixture.palette.open('wide');
    key(input(fixture.container), 'ArrowDown');
    clock = 450;
    for (const frame of pending) frame();
    expect(active(fixture.container).dataset.key).toBe('wide');
    expect(fixture.deps.camera.zoom).toBe(1 / 3);
  });

  it('destroy disposes the animator and overlay', () => {
    const clock = 0;
    const animatorFrames: (() => void)[] = [];
    const overlayFrames: (() => void)[] = [];
    const overlay = makeHost();
    const fixture = makeDeps({
      overlayHost: overlay.host,
      frames: {
        requestFrame: (callback) => (animatorFrames.push(callback), animatorFrames.length),
        cancelFrame: () => undefined,
      },
      now: () => clock,
    });
    addAction(fixture.harness, 'test.ping', 'Ping test');
    addHit(fixture.harness, 'note', 'Budget ping', 'budget');
    fixture.palette.open('ping');
    key(input(fixture.container), 'ArrowDown');
    expect(animatorFrames).toHaveLength(1);
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      overlayFrames.push(callback);
      return overlayFrames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    fixture.palette.close();
    expect(overlayFrames).toHaveLength(1);
    const animatorFrame = animatorFrames[0];
    const overlayFrame = overlayFrames[0];
    if (!animatorFrame || !overlayFrame) throw new Error('missing queued frame');
    const position = fixture.deps.camera.position;
    const zoom = fixture.deps.camera.zoom;
    fixture.palette.destroy();
    expect(() => {
      animatorFrame();
      overlayFrame();
    }).not.toThrow();
    expect(overlay.unregister).toHaveBeenCalledOnce();
    const canvas = recordingCanvas();
    overlay.getRenderer()?.(canvas.ctx);
    expect(overlay.getRenderer()).toBeNull();
    expect(canvas.strokes).toEqual([]);
    expect(fixture.deps.camera.position).toEqual(position);
    expect(fixture.deps.camera.zoom).toBe(zoom);
    expect(animatorFrames).toHaveLength(1);
    expect(overlayFrames).toHaveLength(1);
  });
});
