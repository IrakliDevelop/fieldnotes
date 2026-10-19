import type { Scene, SceneId, SceneInstance, Shell } from '../scene';
import { renderMenu } from './menu';
import { renderSceneSwitcher } from './scene-switcher';
import { bindShortcuts } from './shortcuts';
import { createToaster } from './toast';
import { renderToolbar } from './toolbar';
import { renderZoomBar } from './zoom-bar';

/** The scene currently mounted in the stage. */
export interface Mounted {
  readonly id: SceneId;
  readonly instance: SceneInstance;
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
  renderMenu(zone(chrome, 'menu'));
  const tools = zone(chrome, 'tools');
  const switcher = document.createElement('div');
  switcher.className = 'scene-switcher';
  zone(chrome, 'top-right').append(switcher);
  const zoom = zone(chrome, 'zoom');
  const toast = createToaster(zone(chrome, 'toast', false));
  let unbindToolbar: (() => void) | null = null;
  let unbindZoom: (() => void) | null = null;
  bindShortcuts(() => current()?.instance ?? null);

  return {
    toast,
    setPeers: () => {
      // Peer avatars are not shown yet.
    },
    refresh: () => {
      const mounted = current();
      if (!mounted) return;
      unbindToolbar?.();
      unbindToolbar = renderToolbar(tools, mounted.instance.viewport, mounted.instance.tools);
      unbindZoom?.();
      unbindZoom = renderZoomBar(zoom, mounted.instance.viewport);
      renderSceneSwitcher(switcher, scenes, mounted.id, switchScene);
    },
  };
}
