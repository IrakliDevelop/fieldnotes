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
  let unregisterViewportRender: (() => void) | undefined;
  const registrations: (() => void)[] = [];

  const syncViewportRegistration = (): void => {
    if (!host) return;
    if (!renderer.isVisible()) {
      unregisterViewportRender?.();
      unregisterViewportRender = undefined;
      return;
    }
    if (unregisterViewportRender) return;

    unregisterViewportRender = host.renderHooks.viewport.register(
      {
        afterElements: (ctx, camera, dimensions) => {
          renderer.render(ctx, camera, dimensions.width, dimensions.height, dimensions.dpr);
        },
      },
      { slot: 'afterSceneBeforeOverlay' },
    );
  };

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
      renderer.setState(manager.getState());
      renderer.setViewMode(manager.getViewMode());
      syncViewportRegistration();

      registrations.push(
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
        }),
      );

      registrations.push(
        h.renderHooks.imageExport.register({
          afterElements: ({ ctx }) => {
            const fogState = renderer.getState();
            const fogMode = renderer.getViewMode();
            if (!renderer.isVisible() || !fogState || fogMode === 'off') return;
            renderer.renderForExport(ctx, fogState, fogMode);
          },
        }),
      );

      registrations.push(
        h.renderHooks.svgExport.register({
          afterElements: ({ appendSvg, viewBox, rasterScale }) => {
            const fogState = renderer.getState();
            const fogMode = renderer.getViewMode();
            if (
              !renderer.isVisible() ||
              !fogState ||
              fogMode === 'off' ||
              typeof document === 'undefined'
            ) {
              return;
            }
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.ceil(viewBox.w * rasterScale));
            canvas.height = Math.max(1, Math.ceil(viewBox.h * rasterScale));
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.scale(rasterScale, rasterScale);
            ctx.translate(-viewBox.x, -viewBox.y);
            renderer.renderForExport(ctx, fogState, fogMode);
            try {
              const href = canvas.toDataURL('image/png');
              if (!href.startsWith('data:')) return;
              appendSvg(
                `<image href="${href}" x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.w}" height="${viewBox.h}" />`,
              );
            } catch {
              // A tainted or unavailable canvas must not make the whole SVG export fail.
            }
          },
        }),
      );

      h.registerPluginHandle('fog', createFogPluginHandle(manager));

      registrations.push(
        h.registerExtraBounds(() => {
          if (!renderer.isVisible()) return null;
          const state = renderer.getState();
          return state ? state.definition.bounds : null;
        }),
      );

      unsubChange = manager.on('change', () => {
        renderer.setState(manager.getState());
        syncViewportRegistration();
        h.requestRender();
        h.invalidateMinimap();
        h.notifyChange();
      });
      unsubView = manager.on('view', () => {
        renderer.setViewMode(manager.getViewMode());
        syncViewportRegistration();
        h.requestRender();
        h.invalidateMinimap();
        h.notifyChange();
      });
    },

    dispose() {
      unregisterViewportRender?.();
      unregisterViewportRender = undefined;
      for (const unregister of registrations.splice(0).reverse()) unregister();
      unsubChange?.();
      unsubView?.();
      manager.dispose();
      renderer.dispose();
      host = undefined;
    },
  };
}
