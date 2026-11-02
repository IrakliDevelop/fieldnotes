/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createViewportHarness } from '../test-helpers/viewport-harness';
import { DEFAULT_PALETTE_STRINGS } from './palette-model';
import { ShortcutsHelp } from './shortcuts-help';

function setup() {
  const harness = createViewportHarness();
  const container = document.createElement('div');
  const wrapper = document.createElement('div');
  wrapper.tabIndex = 0;
  document.body.append(container, wrapper);
  const closeOthers = vi.fn();
  const help = new ShortcutsHelp({
    container,
    wrapper,
    actions: harness.viewport.actions,
    getActionContext: () => ({
      viewport: harness.viewport,
      store: harness.viewport.store,
      selectedIds: [],
    }),
    getBindings: () => harness.viewport.shortcuts.getBindings(),
    matchShortcut: (event) =>
      (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' ? 'palette.open' : null,
    isMac: () => false,
    strings: DEFAULT_PALETTE_STRINGS,
    closeOthers,
  });
  return { harness, container, wrapper, closeOthers, help };
}

afterEach(() => document.body.replaceChildren());

describe('shortcuts help', () => {
  it('open renders sections and keys and focuses the dialog', () => {
    const { help, container, closeOthers, harness } = setup();
    help.open();
    const root = container.querySelector<HTMLElement>('.fieldnotes-help');
    expect(root).not.toBeNull();
    expect(root?.getAttribute('role')).toBe('dialog');
    expect(root?.getAttribute('aria-modal')).toBe('true');
    expect(root?.getAttribute('aria-label')).toBe('Keyboard shortcuts');
    expect([...container.querySelectorAll('h3')].map((node) => node.textContent)).toEqual([
      'Edit',
      'Select',
      'Arrange',
      'View',
      'Tools',
      'Palette',
      'While presenting',
    ]);
    expect(root?.textContent).toContain('Undo');
    expect(root?.textContent).toContain('Ctrl+Z');
    expect(root?.textContent).toContain('Ctrl+Y');
    expect(root?.textContent).toContain('Ctrl+Shift+Z');
    expect(document.activeElement).toBe(root);
    expect(closeOthers).toHaveBeenCalledOnce();
    help.destroy();
    harness.cleanup();
  });

  it('a rebind shows on the next open', () => {
    const { help, container, harness } = setup();
    help.open();
    help.close();
    harness.viewport.shortcuts.rebind('edit.undo', 'mod+u');
    help.open();
    expect(container.textContent).toContain('Ctrl+U');
    help.close();
    harness.viewport.shortcuts.disable('edit.undo');
    help.open();
    expect(container.textContent).not.toContain('Undo');
    help.destroy();
    harness.cleanup();
  });

  it('Escape, ? and the Close button close and focus the wrapper', () => {
    const { help, container, wrapper, harness } = setup();
    for (const key of ['Escape', '?']) {
      help.open();
      container
        .querySelector<HTMLElement>('.fieldnotes-help')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      expect(help.isOpen()).toBe(false);
      expect(document.activeElement).toBe(wrapper);
    }
    help.open();
    container.querySelector<HTMLButtonElement>('.fieldnotes-help-close')?.click();
    expect(help.isOpen()).toBe(false);
    expect(document.activeElement).toBe(wrapper);
    help.destroy();
    harness.cleanup();
  });

  it('Tab and Shift+Tab keep focus on Close', () => {
    const { help, container, harness } = setup();
    help.open();
    const root = container.querySelector<HTMLElement>('.fieldnotes-help');
    const close = container.querySelector<HTMLButtonElement>('.fieldnotes-help-close');
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    root?.dispatchEvent(tab);
    expect(document.activeElement).toBe(close);
    expect(tab.defaultPrevented).toBe(true);
    const shift = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    close?.dispatchEvent(shift);
    expect(document.activeElement).toBe(close);
    expect(shift.defaultPrevented).toBe(true);
    help.destroy();
    harness.cleanup();
  });

  it('a modified palette.open key inside the help is prevented and the help stays open', () => {
    const { help, container, harness } = setup();
    help.open();
    const root = container.querySelector<HTMLElement>('.fieldnotes-help');
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    root?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(help.isOpen()).toBe(true);
    help.destroy();
    harness.cleanup();
  });

  it('open while open is a no-op and close while closed is a no-op', () => {
    const { help, closeOthers, harness } = setup();
    help.close();
    help.open();
    help.open();
    expect(closeOthers).toHaveBeenCalledOnce();
    help.destroy();
    harness.cleanup();
  });
  it('destroy closes without focusing', () => {
    const { help, container, wrapper, harness } = setup();
    help.open();
    help.destroy();
    expect(container.children).toHaveLength(0);
    expect(help.isOpen()).toBe(false);
    expect(document.activeElement).not.toBe(wrapper);
    harness.cleanup();
  });
});
