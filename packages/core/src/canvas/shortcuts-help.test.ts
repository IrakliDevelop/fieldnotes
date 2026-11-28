/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createViewportHarness } from '../test-helpers/viewport-harness';
import { DEFAULT_PALETTE_STRINGS } from './palette-model';
import { ShortcutsHelp } from './shortcuts-help';
import { resolveTheme } from './theme';

const cleanup: (() => void)[] = [];

function setup(getTheme?: () => ReturnType<typeof resolveTheme>) {
  const harness = createViewportHarness();
  cleanup.push(() => harness.cleanup());
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
    getTheme,
  });
  cleanup.push(() => help.destroy());
  return { harness, container, wrapper, closeOthers, help };
}

afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
  vi.useRealTimers();
  document.body.replaceChildren();
  document.head
    .querySelectorAll('style[data-fieldnotes-palette]')
    .forEach((style) => style.remove());
});

describe('shortcuts help', () => {
  it('marks dark help roots and leaves default roots unmarked', () => {
    const dark = setup(() => resolveTheme('dark'));
    dark.help.open();
    const darkRoot = dark.container.querySelector<HTMLElement>('.fieldnotes-help');
    expect(darkRoot?.dataset.fieldnotesTheme).toBe('dark');
    expect(darkRoot?.style.colorScheme).toBe('dark');
    expect(darkRoot?.style.getPropertyValue('--fieldnotes-palette-theme-bg')).toBe('#2a2b30');
    dark.help.close();

    const light = setup();
    light.help.open();
    const lightRoot = light.container.querySelector<HTMLElement>('.fieldnotes-help');
    expect(lightRoot?.dataset.fieldnotesTheme).toBeUndefined();
    expect(lightRoot?.style.colorScheme).toBe('');
    for (const property of ['bg', 'border', 'shadow', 'fg', 'active', 'muted']) {
      expect(lightRoot?.style.getPropertyValue(`--fieldnotes-palette-theme-${property}`)).toBe('');
    }
  });

  it('shows the action id when an action label throws', () => {
    const { harness, container, help } = setup();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('label bug');
    const remove = harness.viewport.actions.register({
      id: 'test.bad-label',
      label: () => {
        throw error;
      },
      shortcut: ['mod+b'],
      perform: () => undefined,
    });
    cleanup.push(remove);

    help.open();

    expect(help.isOpen()).toBe(true);
    expect(container.textContent).toContain('test.bad-label');
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(
      '[fieldnotes] action label() failed for "test.bad-label"',
      error,
    );
    errorSpy.mockRestore();
  });

  it('open renders sections and keys and focuses the dialog', () => {
    const { harness, help, container, closeOthers } = setup();
    cleanup.push(
      harness.viewport.actions.register({
        id: 'presentation.test',
        label: 'Present',
        perform: () => undefined,
      }),
    );
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
      'Selection',
    ]);
    expect(root?.textContent).toContain('Undo');
    expect(root?.textContent).toContain('Ctrl+Z');
    expect(root?.textContent).toContain('Ctrl+Y');
    expect(root?.textContent).toContain('Ctrl+Shift+Z');
    expect(container.querySelector('.fieldnotes-help-close')?.textContent).toBe('Close');
    expect(document.activeElement).toBe(root);
    expect(closeOthers).toHaveBeenCalledOnce();
  });

  it('omits the presentation section when no presentation action is defined', () => {
    const { help, container } = setup();
    help.open();
    const titles = [...container.querySelectorAll('h3')].map((node) => node.textContent);
    expect(titles).toContain('Palette');
    expect(titles).not.toContain('While presenting');
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
  });

  it('Escape, ? and the Close button close and focus the wrapper', () => {
    const { help, container, wrapper } = setup();
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
  });

  it('close preserves focus moved to an outside input', () => {
    const { help } = setup();
    const outside = document.createElement('input');
    document.body.append(outside);
    cleanup.push(() => outside.remove());
    help.open();
    outside.focus();

    help.close();

    expect(document.activeElement).toBe(outside);
  });

  it('Tab and Shift+Tab keep focus on Close', () => {
    const { help, container } = setup();
    help.open();
    const root = container.querySelector<HTMLElement>('.fieldnotes-help');
    const close = container.querySelector<HTMLButtonElement>('.fieldnotes-help-close');
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    root?.dispatchEvent(tab);
    expect(document.activeElement).toBe(close);
    expect(tab.defaultPrevented).toBe(true);
    const repeatedTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    close?.dispatchEvent(repeatedTab);
    expect(document.activeElement).toBe(close);
    expect(repeatedTab.defaultPrevented).toBe(true);
    const shift = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    close?.dispatchEvent(shift);
    expect(document.activeElement).toBe(close);
    expect(shift.defaultPrevented).toBe(true);
  });

  it('a modified palette.open key inside the help is prevented and the help stays open', () => {
    const { help, container } = setup();
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
    const plain = new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true });
    root?.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(help.isOpen()).toBe(true);
  });

  it('open while open is a no-op and close while closed is a no-op', () => {
    const { help, closeOthers } = setup();
    help.close();
    help.open();
    help.open();
    expect(closeOthers).toHaveBeenCalledOnce();
  });
  it('destroy closes without focusing', () => {
    const { help, container } = setup();
    help.open();
    const root = container.querySelector<HTMLElement>('.fieldnotes-help');
    expect(root).not.toBeNull();
    expect(help.isOpen()).toBe(true);
    expect(document.activeElement).toBe(root);
    help.destroy();
    expect(root?.isConnected).toBe(false);
    expect(help.isOpen()).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });
});
