import type { Scene, SceneId, SceneInstance, Shell } from '../scene';
import { icon } from './icons';
import type { IconName } from './icons';
import { renderLayersPanel } from './layers-panel';
import { renderMenu } from './menu';
import { renderSceneSwitcher } from './scene-switcher';
import { bindShortcuts } from './shortcuts';
import { renderStylePanel } from './style-panel';
import { createToaster } from './toast';
import { renderToolbar } from './toolbar';
import { renderZoomBar } from './zoom-bar';

/** The scene currently in the stage; `instance` is null when its mount threw. */
export interface Mounted {
  readonly id: SceneId;
  readonly instance: SceneInstance | null;
}

const MAX_AVATARS = 4;

function avatar(className: string, text: string, title: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  // Names come from peers, so they only ever reach textContent.
  el.textContent = text;
  el.title = title;
  return el;
}

const initials = (name: string): string =>
  name
    .split(' ')
    .map((word) => word.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

function sheetToggle(label: string, name: IconName): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-button';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.setAttribute('aria-expanded', 'false');
  button.append(icon(name));
  // Keep focus on the canvas so core's undo/redo keys still apply after a click.
  button.addEventListener('mousedown', (event) => event.preventDefault());
  return button;
}

function zone(parent: HTMLElement, name: string, island = true): HTMLElement {
  const root = document.createElement('div');
  if (island) root.className = 'island';
  root.dataset['chrome'] = name;
  parent.append(root);
  return root;
}

/** Builds the chrome zones in `chrome` and returns the Shell scenes talk to. */
export function createShell(
  chrome: HTMLElement,
  scenes: readonly Scene[],
  current: () => Mounted | null,
  switchScene: (id: SceneId) => void,
): Shell {
  const header = document.createElement('div');
  header.className = 'header-row';
  chrome.append(header);
  const closeMenu = renderMenu(zone(header, 'menu'));
  const tools = zone(header, 'tools');
  const switcher = document.createElement('div');
  switcher.className = 'scene-switcher';
  // Narrow layouts only, pinned at the start of the tool pill: the sheet opens on demand.
  const styleToggle = sheetToggle('Style', 'palette');
  styleToggle.dataset['styleToggle'] = '';
  const layersToggle = sheetToggle('Layers', 'layers');
  const avatars = document.createElement('div');
  avatars.className = 'avatars';
  const topRight = zone(header, 'top-right');
  topRight.append(switcher, layersToggle, avatars);
  const zoom = zone(chrome, 'zoom');
  const style = zone(chrome, 'style');
  const layers = zone(chrome, 'layers');
  const setStyleOpen = (open: boolean): void => {
    style.toggleAttribute('data-open', open);
    styleToggle.setAttribute('aria-expanded', String(open));
    if (open) setLayersOpen(false);
  };
  const setLayersOpen = (open: boolean): void => {
    layers.hidden = !open;
    layersToggle.setAttribute('aria-expanded', String(open));
    if (open) setStyleOpen(false);
  };
  setLayersOpen(false);
  styleToggle.addEventListener('click', () =>
    setStyleOpen(styleToggle.getAttribute('aria-expanded') !== 'true'),
  );
  layersToggle.addEventListener('click', () =>
    setLayersOpen(layersToggle.getAttribute('aria-expanded') !== 'true'),
  );
  const toast = createToaster(zone(chrome, 'toast', false));
  let unbinders: (() => void)[] = [];
  bindShortcuts(() => current()?.instance ?? null);

  return {
    toast,
    setPeers: (peers) => {
      const shown = peers.slice(0, MAX_AVATARS).map((peer) => {
        const el = avatar('avatar', initials(peer.name), peer.name);
        el.dataset['peer'] = peer.id;
        el.style.backgroundColor = peer.color;
        return el;
      });
      const extra = peers.length - MAX_AVATARS;
      if (extra > 0) shown.push(avatar('avatar avatar-more', `+${extra}`, `${extra} more`));
      avatars.replaceChildren(...shown);
      // Phones show only this count, as a badge on the Collaborate button.
      const collaborate = topRight.querySelector<HTMLElement>('[data-collaborate]');
      if (!collaborate) return;
      if (peers.length > 0) collaborate.dataset['peerCount'] = String(peers.length);
      else delete collaborate.dataset['peerCount'];
    },
    refresh: () => {
      closeMenu();
      for (const unbind of unbinders) unbind();
      unbinders = [];
      const mounted = current();
      if (!mounted) return;
      renderSceneSwitcher(switcher, scenes, mounted.id, switchScene);
      const { instance } = mounted;
      for (const el of [tools, zoom, layersToggle]) el.hidden = !instance;
      if (!instance) {
        style.hidden = true;
        setStyleOpen(false);
        setLayersOpen(false);
        return;
      }
      const { viewport } = instance;
      unbinders = [
        renderToolbar(tools, viewport, instance.tools),
        renderZoomBar(zoom, viewport),
        renderStylePanel(style, viewport, instance.styles, (hasControls) => {
          styleToggle.disabled = !hasControls;
          if (!hasControls) setStyleOpen(false);
        }),
        renderLayersPanel(layers, viewport),
      ];
      // renderToolbar replaces the pill's children, so the toggle goes back in after it.
      tools.prepend(styleToggle);
    },
  };
}
