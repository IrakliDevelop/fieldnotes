import type { ViewportPlugin, ViewportPluginHost } from '@fieldnotes/core';
import type { FogRendererOptions } from './fog-renderer';
import { FogManager } from './fog-manager';
import { FogRenderer } from './fog-renderer';
import { createFogPluginHandle } from './fog-plugin-handle';

export interface FogPlugin extends ViewportPlugin {
  readonly manager: FogManager;
  setOptions(options: FogRendererOptions): void;
}

export interface CreateFogPluginOptions extends FogRendererOptions {
  manager?: FogManager;
}

export function createFogPlugin(options?: CreateFogPluginOptions): FogPlugin {
  const manager = options?.manager ?? new FogManager();
  const renderer = new FogRenderer(options);
  let host: ViewportPluginHost | undefined;
  let unsubChange: (() => void) | undefined;
  let unsubView: (() => void) | undefined;

  return {
    name: 'fog',

    get manager() {
      return manager;
    },

    setOptions(opts: FogRendererOptions) {
      renderer.setOptions(opts);
      host?.requestRender();
      host?.invalidateMinimap();
    },

    install(h: ViewportPluginHost) {
      host = h;

      h.renderHooks.viewport.register(
        {
          afterElements: (ctx, camera, dimensions) => {
            if (renderer.isVisible()) {
              renderer.render(ctx, camera, dimensions.width, dimensions.height, dimensions.dpr);
            }
          },
        },
        { slot: 'afterSceneBeforeOverlay' },
      );

      h.renderHooks.minimap.register({
        afterElements: (mapping) => {
          if (!renderer.isVisible()) return;
          const fogState = renderer.getState();
          const fogMode = renderer.getViewMode();
          if (!fogState || (fogMode !== 'editor' && fogMode !== 'player')) return;
          const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
          mapping.ctx.save();
          mapping.ctx.setTransform(
            dpr * mapping.scale,
            0,
            0,
            dpr * mapping.scale,
            dpr * mapping.offsetX,
            dpr * mapping.offsetY,
          );
          renderer.renderForExport(mapping.ctx, fogState, fogMode);
          mapping.ctx.restore();
        },
      });

      h.registerPluginHandle('fog', createFogPluginHandle(manager));

      h.registerExtraBounds(() => {
        if (!renderer.isVisible()) return null;
        const state = renderer.getState();
        return state ? state.definition.bounds : null;
      });

      unsubChange = manager.on('change', () => {
        renderer.setState(manager.getState());
        h.requestRender();
        h.invalidateMinimap();
        h.notifyChange();
      });
      unsubView = manager.on('view', () => {
        renderer.setViewMode(manager.getViewMode());
        h.requestRender();
        h.invalidateMinimap();
        h.notifyChange();
      });
    },

    dispose() {
      unsubChange?.();
      unsubView?.();
      manager.dispose();
      renderer.dispose();
    },
  };
}
