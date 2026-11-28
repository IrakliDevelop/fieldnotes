import type { ActionRegistry } from '../actions/action-registry';
import type { ActionContext, ActionDefinition } from '../actions/types';
import type { Bounds } from '../core/types';
import type { PaletteApi } from './command-palette';
import type { Minimap } from './minimap';
import type { PresentationApi, PresentationSlide, PresentationState } from './presentation';
import type { ShortcutsHelpApi } from './shortcuts-help';
import type { Viewport } from './viewport';
import type { ViewportPlugin } from './viewport-plugin';

/** The internal seam built-in features use to reach viewport collaborators. */
export interface FeatureHost {
  readonly container: HTMLElement;
  readonly wrapper: HTMLElement;
  readonly actions: ActionRegistry;
  getActionContext(): ActionContext;
  getBindings(): Record<string, string[]>;
  matchShortcut(event: KeyboardEvent): string | null;
  stopCameraMotion(): void;
  closeContextMenu(): void;
  selectionColor(): string;
  clearSelection(): void;
  isMac(): boolean;
  getExtraBounds(): Bounds | null;
  /** Context menu, interact mode, or any registered overlay is open. */
  hasOpenOverlay(): boolean;
  trackOverlay(isOpen: () => boolean): () => void;
  setPresentation(api: PresentationApi | null): void;
  setPalette(palette: PaletteApi | null, help: ShortcutsHelpApi | null): void;
  setMinimap(minimap: Minimap | null): void;
}

export type FeatureHostDeps = Omit<FeatureHost, 'hasOpenOverlay' | 'trackOverlay'> & {
  viewport: Viewport;
  /** Overlays the viewport owns directly. */
  hasViewportOverlay(): boolean;
};

// Module-private so third-party plugins cannot reach the host.
const hosts = new WeakMap<Viewport, FeatureHost>();

function noop(): void {
  // Inert methods and unsubscribes that have nothing to do.
}

export function featureHostOf(viewport: Viewport): FeatureHost {
  const host = hosts.get(viewport);
  if (!host) throw new Error('Viewport: no feature host');
  return host;
}

export function createFeatureHost({
  viewport,
  hasViewportOverlay,
  ...deps
}: FeatureHostDeps): FeatureHost {
  const overlays = new Set<() => boolean>();
  const host: FeatureHost = {
    ...deps,
    hasOpenOverlay: () => hasViewportOverlay() || [...overlays].some((isOpen) => isOpen()),
    trackOverlay: (isOpen) => {
      overlays.add(isOpen);
      return () => overlays.delete(isOpen);
    },
  };
  hosts.set(viewport, host);
  return host;
}

/** Always prepended to `plugins` so these actions keep their place after presentation's. */
export function coreActionsPlugin(actions: readonly ActionDefinition[]): ViewportPlugin {
  return {
    name: 'fieldnotes:core-actions',
    required: true,
    priority: -950,
    configure: (context) => {
      for (const action of actions) context.registerAction(action);
    },
  };
}

// One frozen state: presentation sources compare snapshots by reference.
const INERT_STATE: PresentationState = Object.freeze({
  active: false,
  index: -1,
  count: 0,
  fullscreen: false,
});
const NO_SLIDES: readonly PresentationSlide[] = Object.freeze([]);

export const INERT_PRESENTATION: PresentationApi = {
  getState: () => INERT_STATE,
  getSlides: () => NO_SLIDES,
  start: () => {
    throw new Error('Viewport: presentation needs `presentationFeature()` in `plugins`');
  },
  exit: noop,
  next: () => false,
  previous: () => false,
  goTo: () => false,
  onChange: () => noop,
};
