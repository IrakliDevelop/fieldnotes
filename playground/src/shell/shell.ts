import type { Scene, SceneId, SceneInstance, Shell } from '../scene';
import { icon } from './icons';
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

function zone(chrome: HTMLElement, name: string, island = true): HTMLElement {
  const root = document.createElement('div');
  if (island) root.className = 'island';
  root.dataset['chrome'] = name;
  chrome.append(root);
  return root;
}

/** Builds the chrome zones in `chrome` and returns the Shell scenes talk to. */
export function createShell(
  chrome: HTMLElement,
  scenes: readonly Scene[],
  current: () => Mounted | null,
  switchScene: (id: SceneId) => void,
): Shell {
  const closeMenu = renderMenu(zone(chrome, 'menu'));
  const tools = zone(chrome, 'tools');
  const switcher = document.createElement('div');
  switcher.className = 'scene-switcher';
  const layersToggle = document.createElement('button');
  layersToggle.type = 'button';
  layersToggle.className = 'icon-button';
  layersToggle.setAttribute('aria-label', 'Layers');
  layersToggle.title = 'Layers';
  layersToggle.setAttribute('aria-expanded', 'false');
  layersToggle.append(icon('layers'));
  zone(chrome, 'top-right').append(switcher, layersToggle);
  const zoom = zone(chrome, 'zoom');
  const style = zone(chrome, 'style');
  const layers = zone(chrome, 'layers');
  const setLayersOpen = (open: boolean): void => {
    layers.hidden = !open;
    layersToggle.setAttribute('aria-expanded', String(open));
  };
  setLayersOpen(false);
  layersToggle.addEventListener('click', () =>
    setLayersOpen(layersToggle.getAttribute('aria-expanded') !== 'true'),
  );
  const toast = createToaster(zone(chrome, 'toast', false));
  let unbinders: (() => void)[] = [];
  bindShortcuts(() => current()?.instance ?? null);

  return {
    toast,
    setPeers: () => {
      // Peer avatars are not shown yet.
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
        setLayersOpen(false);
        return;
      }
      const { viewport } = instance;
      unbinders = [
        renderToolbar(tools, viewport, instance.tools),
        renderZoomBar(zoom, viewport),
        renderStylePanel(style, viewport, instance.styles),
        renderLayersPanel(layers, viewport),
      ];
    },
  };
}
