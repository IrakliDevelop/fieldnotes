import type { Scene, SceneId, SceneInstance, Shell } from '../scene';
import { renderSceneSwitcher } from './scene-switcher';
import { bindShortcuts } from './shortcuts';
import { renderToolbar } from './toolbar';

/** The scene currently mounted in the stage. */
export interface Mounted {
  readonly id: SceneId;
  readonly instance: SceneInstance;
}

function zone(chrome: HTMLElement, name: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'island';
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
  const tools = zone(chrome, 'tools');
  const switcher = document.createElement('div');
  switcher.className = 'scene-switcher';
  zone(chrome, 'top-right').append(switcher);
  let unbindToolbar: (() => void) | null = null;
  bindShortcuts(() => current()?.instance ?? null);

  return {
    toast: (message) => console.info(message),
    setPeers: () => {
      // Peer avatars are not shown yet.
    },
    refresh: () => {
      const mounted = current();
      if (!mounted) return;
      unbindToolbar?.();
      unbindToolbar = renderToolbar(tools, mounted.instance.viewport, mounted.instance.tools);
      renderSceneSwitcher(switcher, scenes, mounted.id, switchScene);
    },
  };
}
