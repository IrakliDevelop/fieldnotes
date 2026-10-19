import type { Viewport } from '@fieldnotes/core';
import type { ToolSpec } from '../scene';
import { icon } from './icons';

// Mirrors the wide-layout media query in layout.css.
const WIDE_QUERY = '(min-width: 901px) and (pointer: fine)';

/** Runs the tool's pre-activation hook, then makes it the active tool. */
export function activateTool(viewport: Viewport, spec: ToolSpec): void {
  spec.beforeActivate?.();
  viewport.setTool(spec.name);
}

/** Renders the tool pill into `root`; returns a cleanup that unbinds its listeners. */
export function renderToolbar(
  root: HTMLElement,
  viewport: Viewport,
  tools: readonly ToolSpec[],
): () => void {
  root.replaceChildren();
  const buttons = new Map<string, HTMLButtonElement>();
  let flyout: HTMLElement | null = null;

  const closeFlyout = (): void => {
    flyout?.remove();
    flyout = null;
  };

  const openFlyout = (spec: ToolSpec, button: HTMLButtonElement): void => {
    closeFlyout();
    const menu = document.createElement('div');
    menu.className = 'island flyout';
    menu.setAttribute('role', 'menu');
    for (const item of spec.flyout ?? []) {
      const entry = document.createElement('button');
      entry.type = 'button';
      entry.className = 'icon-button';
      entry.setAttribute('role', 'menuitem');
      entry.setAttribute('aria-label', item.label);
      entry.title = item.label;
      entry.append(icon(item.icon));
      entry.addEventListener('click', () => {
        item.select();
        viewport.setTool(spec.name);
      });
      menu.append(entry);
    }
    const rect = button.getBoundingClientRect();
    if (matchMedia(WIDE_QUERY).matches) menu.style.top = `${rect.bottom + 8}px`;
    else menu.style.bottom = `${innerHeight - rect.top + 8}px`;
    root.append(menu);
    menu.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - menu.offsetWidth - 12))}px`;
    flyout = menu;
  };

  for (const spec of tools) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button';
    button.setAttribute('aria-label', spec.label);
    button.title = `${spec.label} — ${spec.key}`;
    const badge = document.createElement('span');
    badge.className = 'key-badge';
    badge.textContent = spec.key.toUpperCase();
    button.append(icon(spec.icon), badge);
    button.addEventListener('click', () => {
      const wasOpen = flyout !== null;
      activateTool(viewport, spec);
      if (spec.flyout && !wasOpen) openFlyout(spec, button);
    });
    buttons.set(spec.name, button);
    root.append(button);
  }

  const sync = (): void => {
    const active = viewport.toolManager.activeTool?.name;
    for (const [name, button] of buttons) {
      button.setAttribute('aria-pressed', String(name === active));
    }
  };
  sync();

  const onOutside = (event: PointerEvent): void => {
    if (event.target instanceof Node && root.contains(event.target)) return;
    closeFlyout();
  };
  window.addEventListener('pointerdown', onOutside);
  const unsubscribe = viewport.toolManager.onChange(() => {
    closeFlyout();
    sync();
  });
  return () => {
    unsubscribe();
    window.removeEventListener('pointerdown', onOutside);
  };
}
