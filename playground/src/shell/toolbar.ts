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
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', 'Tools');
  const buttons = new Map<string, HTMLButtonElement>();
  // Last flyout pick per tool; FlyoutItem cannot report the tool's current option.
  const picked = new Map<string, string>();
  let flyout: HTMLElement | null = null;

  const closeFlyout = (): void => {
    flyout?.remove();
    flyout = null;
    for (const button of buttons.values()) {
      if (button.hasAttribute('aria-expanded')) button.setAttribute('aria-expanded', 'false');
    }
  };

  const openFlyout = (spec: ToolSpec, button: HTMLButtonElement): void => {
    closeFlyout();
    const menu = document.createElement('div');
    menu.className = 'island flyout';
    menu.setAttribute('role', 'menu');
    const current = picked.get(spec.name) ?? spec.flyout?.[0]?.id;
    const entries: HTMLButtonElement[] = [];
    for (const item of spec.flyout ?? []) {
      const entry = document.createElement('button');
      entry.type = 'button';
      entry.className = 'icon-button';
      entry.setAttribute('role', 'menuitemradio');
      entry.setAttribute('aria-checked', String(item.id === current));
      entry.setAttribute('aria-label', item.label);
      entry.title = item.label;
      entry.append(icon(item.icon));
      entry.addEventListener('click', () => {
        picked.set(spec.name, item.id);
        item.select();
        viewport.setTool(spec.name);
        // Back to the canvas, like style buttons, so Escape and shortcuts reach the tool.
        document.querySelector<HTMLElement>('#stage [tabindex]')?.focus();
      });
      entries.push(entry);
      menu.append(entry);
    }
    menu.addEventListener('keydown', (event) => {
      const index = entries.findIndex((entry) => entry === document.activeElement);
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      if (event.key === 'Escape') {
        closeFlyout();
        button.focus();
      } else if (step !== undefined) {
        entries.at((index + step) % entries.length)?.focus();
      } else {
        return;
      }
      // Keep core's window shortcuts (nudge, deselect) from also handling the key.
      event.preventDefault();
      event.stopPropagation();
    });
    const rect = button.getBoundingClientRect();
    if (matchMedia(WIDE_QUERY).matches) menu.style.top = `${rect.bottom + 8}px`;
    else menu.style.bottom = `${innerHeight - rect.top + 8}px`;
    root.append(menu);
    menu.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - menu.offsetWidth - 12))}px`;
    flyout = menu;
    button.setAttribute('aria-expanded', 'true');
    (entries.find((entry) => entry.getAttribute('aria-checked') === 'true') ?? entries[0])?.focus();
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
    if (spec.flyout) {
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-expanded', 'false');
    }
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
