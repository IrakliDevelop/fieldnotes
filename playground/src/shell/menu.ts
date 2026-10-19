import { VERSION } from '@fieldnotes/core';
import { icon } from './icons';
import type { IconName } from './icons';

/** A command in the ☰ menu. */
export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  run(): void;
  hidden?: () => boolean;
}

type MenuGroup = 'file' | 'board' | 'room';

const groups: Record<MenuGroup, MenuItem[]> = { file: [], board: [], room: [] };

const LINKS = [
  { label: 'Dev playground', href: './dev/' },
  { label: 'API reference', href: './api/' },
  { label: 'GitHub', href: 'https://github.com/IrakliDevelop/fieldnotes', external: true },
];

/** Adds items to a ☰ menu group; returns a function that removes them. */
export function addMenuItems(group: MenuGroup, items: readonly MenuItem[]): () => void {
  groups[group].push(...items);
  return () => {
    groups[group] = groups[group].filter((item) => !items.includes(item));
  };
}

function section(children: readonly HTMLElement[]): HTMLElement {
  const el = document.createElement('div');
  el.className = 'menu-group';
  el.append(...children);
  return el;
}

/** Renders the ☰ button and its popover into `root`; returns a function that closes the popover. */
export function renderMenu(root: HTMLElement): () => void {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'icon-button';
  toggle.setAttribute('aria-label', 'Menu');
  toggle.setAttribute('aria-haspopup', 'true');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.append(icon('menu'));
  root.append(toggle);
  // Keep focus on the canvas so core's undo/redo keys apply right after an item runs.
  root.addEventListener('mousedown', (event) => {
    if (event.target instanceof Element && event.target.closest('button')) event.preventDefault();
  });
  let popover: HTMLElement | null = null;
  let previousFocus: Element | null = null;

  // Focus inside the menu (keyboard open) or on body falls back to the canvas so undo keys work.
  const restoreFocus = (): void => {
    const target =
      previousFocus instanceof HTMLElement &&
      previousFocus !== document.body &&
      !root.contains(previousFocus)
        ? previousFocus
        : document.querySelector<HTMLElement>('#stage [tabindex]');
    target?.focus();
  };

  const close = (): void => {
    if (!popover) return;
    popover.remove();
    popover = null;
    toggle.setAttribute('aria-expanded', 'false');
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('pointerdown', onOutside);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    close();
    restoreFocus();
  };

  const onOutside = (event: PointerEvent): void => {
    if (event.target instanceof Node && root.contains(event.target)) return;
    close();
  };

  const open = (): void => {
    previousFocus = document.activeElement;
    const el = document.createElement('div');
    el.className = 'island menu-popover';
    for (const items of Object.values(groups)) {
      const buttons = items
        .filter((item) => !item.hidden?.())
        .map((item) => {
          const entry = document.createElement('button');
          entry.type = 'button';
          entry.className = 'menu-item';
          entry.dataset['menuItem'] = item.id;
          entry.append(icon(item.icon), item.label);
          entry.addEventListener('click', () => {
            close();
            restoreFocus();
            item.run();
          });
          return entry;
        });
      if (buttons.length > 0) el.append(section(buttons));
    }
    const links = LINKS.map(({ label, href, external }) => {
      const link = document.createElement('a');
      link.className = 'menu-item';
      link.href = href;
      link.textContent = label;
      if (external) {
        link.target = '_blank';
        link.rel = 'noopener';
      }
      link.addEventListener('click', close);
      return link;
    });
    const version = document.createElement('p');
    version.className = 'menu-version';
    version.textContent = `Field Notes v${VERSION}`;
    el.append(section(links), version);
    root.append(el);
    popover = el;
    toggle.setAttribute('aria-expanded', 'true');
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onOutside);
  };

  toggle.addEventListener('click', () => (popover ? close() : open()));
  return close;
}
