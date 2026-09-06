import type { Bounds } from '../core/types';
import type { Command } from '../history/types';
import type { ElementStore } from '../elements/element-store';
import type { PluginHandle } from '../core/plugin-state-manager';
import type { RenderHooks } from './render-hooks';

export interface ViewportPluginHost {
  readonly renderHooks: RenderHooks;
  readonly store: ElementStore;
  pushHistory(command: Command): void;
  requestRender(): void;
  invalidateMinimap(): void;
  registerPluginHandle(name: string, handle: PluginHandle): void;
  registerExtraBounds(provider: () => Bounds | null): () => void;
  onChange(listener: () => void): () => void;
  notifyChange(): void;
}

export interface ViewportPlugin {
  readonly name: string;
  install(host: ViewportPluginHost): void;
  dispose?(): void;
}
