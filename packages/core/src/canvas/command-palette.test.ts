/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNote } from '../elements/element-factory';
import { createViewportHarness } from '../test-helpers/viewport-harness';
import { Camera } from './camera';
import { CommandPalette, createPaletteActions } from './command-palette';
import { DEFAULT_PALETTE_STRINGS } from './palette-model';
import type { CommandPaletteDeps } from './command-palette';

const cleanup: (() => void)[] = [];

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

function rows(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('[role="option"]')];
}
function type(container: HTMLElement, value: string) {
  const input = container.querySelector<HTMLInputElement>('input');
  if (!input) throw new Error('missing input');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input;
}

afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
  vi.useRealTimers();
  document.body.replaceChildren();
  document.head
    .querySelectorAll('style[data-fieldnotes-palette]')
    .forEach((style) => style.remove());
});

describe('command palette', () => {
  it('open mounts the palette, focuses the input and lists enabled actions', () => {
    const { harness, container, palette, calls } = makeDeps();
    const remove = harness.viewport.actions.register({
      id: 'test.ping',
      label: 'Ping test',
      perform: () => undefined,
    });
    cleanup.push(remove);
    palette.open();
    const input = container.querySelector<HTMLInputElement>('[role="combobox"]');
    expect(input?.getAttribute('aria-expanded')).toBe('true');
    expect(input?.placeholder).toBe('Search actions and the board');
    expect(document.activeElement).toBe(input);
    expect(rows(container).some((row) => row.textContent?.includes('Ping test'))).toBe(true);
    expect(rows(container).some((row) => row.dataset.key === 'palette.open')).toBe(false);
    expect(input?.getAttribute('aria-activedescendant')).toBe(
      container.querySelector('.fieldnotes-palette-option--active')?.id,
    );
    expect(container.querySelector('.fieldnotes-palette-status')?.textContent).toBe(
      String(rows(container).length),
    );
    expect(calls.context).toHaveBeenCalledOnce();
    expect(calls.help).toHaveBeenCalledOnce();
  });
  it('typing filters actions and adds board hits without parsing hostile text', () => {
    const { harness, container, palette } = makeDeps();
    harness.viewport.store.add(createNote({ position: { x: 0, y: 0 }, text: 'Budget 2026' }));
    harness.viewport.store.add(createNote({ position: { x: 0, y: 0 }, text: '&lt;img src=x&gt;' }));
    palette.open();
    type(container, 'bud');
    expect(container.textContent).toContain('On the board');
    expect(container.querySelector('mark')?.textContent).toBe('Bud');
    type(container, 'img');
    expect(container.textContent).toContain('<img src=x>');
    expect(container.querySelector('img')).toBeNull();
  });
  it('moves, commits after close, and isolates keys', () => {
    const { harness, container, wrapper, palette } = makeDeps();
    const ping = vi.fn(() => expect(palette.isOpen()).toBe(false));
    const remove = harness.viewport.actions.register({
      id: 'test.ping',
      label: 'Ping test',
      perform: ping,
    });
    cleanup.push(remove);
    palette.open('ping');
    const input = type(container, 'ping');
    const modified = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(true);
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(ping).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(wrapper);
  });
  it('live re-renders, destroys subscriptions, and never moves the camera', async () => {
    const { harness, container, palette, deps } = makeDeps();
    palette.open('zebra');
    harness.viewport.store.add(createNote({ position: { x: 0, y: 0 }, text: 'Zebra' }));
    await Promise.resolve();
    expect(rows(container)).toHaveLength(1);
    expect(deps.stopCameraMotion).not.toHaveBeenCalled();
    palette.destroy();
    harness.viewport.store.add(createNote({ position: { x: 0, y: 0 }, text: 'Zebra two' }));
    await Promise.resolve();
    expect(container.children).toHaveLength(0);
  });
  it('closes on deferred outside pointerdown and appends one stylesheet', () => {
    vi.useFakeTimers();
    const first = makeDeps();
    const second = makeDeps();
    first.palette.open();
    second.palette.open();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(first.palette.isOpen()).toBe(true);
    vi.advanceTimersByTime(0);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(first.palette.isOpen()).toBe(false);
    expect(document.head.querySelectorAll('style[data-fieldnotes-palette]')).toHaveLength(1);
  });
  it('creates the approved palette actions', () => {
    const palette = { open: vi.fn(), close: vi.fn(), isOpen: () => false };
    const help = { open: vi.fn(), close: vi.fn(), isOpen: () => false };
    expect(createPaletteActions(palette, help).map((action) => action.id)).toEqual([
      'palette.open',
      'palette.help',
    ]);
  });
});
