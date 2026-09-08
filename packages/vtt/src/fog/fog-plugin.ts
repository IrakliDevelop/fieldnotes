import {
  createServiceKey,
  type PluginConfigureContext,
  type PluginStartContext,
  type ViewportPlugin,
} from '@fieldnotes/core';
import type { FogRendererOptions } from './fog-renderer';
import { FogManager } from './fog-manager';
import { FogRenderer } from './fog-renderer';
import { createFogPluginHandle } from './fog-plugin-handle';

export const FogManagerKey = createServiceKey<FogManager>('vtt:fog-manager');

export interface FogPlugin extends ViewportPlugin {
  readonly manager: FogManager;
  setOptions(options: FogRendererOptions): void;
}

export interface CreateFogPluginOptions extends FogRendererOptions {
  manager?: FogManager;
}

interface PendingInstance {
  renderer?: FogRenderer;
}

export function createFogPlugin(options?: CreateFogPluginOptions): FogPlugin {
  const manager = options?.manager ?? new FogManager();
  let rendererOptions: FogRendererOptions = options ?? {};
  const pending: PendingInstance[] = [];
  const liveRenderers = new Set<FogRenderer>();

  const configure = (context: PluginConfigureContext): void => {
    const instance: PendingInstance = {};
    pending.push(instance);
    const renderer = (): FogRenderer | undefined => instance.renderer;
    const hookOptions = { required: true, satisfies: ['vtt:fog'] } as const;

    context.registerViewportHooks(
      {
        afterElements: (ctx, camera, dimensions) => {
          renderer()?.render(ctx, camera, dimensions.width, dimensions.height, dimensions.dpr);
        },
      },
      {
        ...hookOptions,
        slot: 'afterSceneBeforeOverlay',
        enabled: () => renderer()?.isVisible() ?? false,
      },
    );
    context.registerMinimapHooks(
      {
        afterElements: (mapping) => {
          const active = renderer();
          if (!active || !active.isVisible()) return;
          const state = active.getState();
          const mode = active.getViewMode();
          if (!state || (mode !== 'editor' && mode !== 'player')) return;
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
          active.renderForExport(mapping.ctx, state, mode);
          mapping.ctx.restore();
        },
      },
      hookOptions,
    );
    context.registerImageExportHooks(
      {
        afterElements: ({ ctx }) => {
          const active = renderer();
          const state = active?.getState();
          const mode = active?.getViewMode();
          if (!active || !active.isVisible() || !state || mode === 'off' || mode === undefined)
            return;
          active.renderForExport(ctx, state, mode);
        },
      },
      hookOptions,
    );
    context.registerSvgExportHooks(
      {
        afterElements: ({ appendSvg, viewBox, rasterScale }) => {
          const active = renderer();
          const state = active?.getState();
          const mode = active?.getViewMode();
          if (
            !active ||
            !active.isVisible() ||
            !state ||
            mode === 'off' ||
            mode === undefined ||
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
          active.renderForExport(ctx, state, mode);
          try {
            const href = canvas.toDataURL('image/png');
            if (href.startsWith('data:')) {
              appendSvg(
                `<image href="${href}" x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.w}" height="${viewBox.h}" />`,
              );
            }
          } catch {
            // A tainted or unavailable canvas must not make the whole SVG export fail.
          }
        },
      },
      hookOptions,
    );
  };

  const start = (context: PluginStartContext) => {
    const instance = pending.shift();
    if (!instance) throw new Error('Fog plugin start called without configure');
    const renderer = new FogRenderer(rendererOptions);
    instance.renderer = renderer;
    liveRenderers.add(renderer);
    renderer.setState(manager.getState());
    renderer.setViewMode(manager.getViewMode());
    context.registerService(FogManagerKey, manager);
    context.registerExtraBounds(() => {
      if (!renderer.isVisible()) return null;
      return renderer.getState()?.definition.bounds ?? null;
    });
    const update = (): void => {
      renderer.setState(manager.getState());
      context.requestRender();
      context.invalidateMinimap();
      context.notifyChange();
    };
    const updateView = (): void => {
      renderer.setViewMode(manager.getViewMode());
      context.requestRender();
      context.invalidateMinimap();
      context.notifyChange();
    };
    context.addDisposer(manager.on('change', update));
    context.addDisposer(manager.on('view', updateView));
    const stateHandle = createFogPluginHandle(manager);
    return {
      ...stateHandle,
      dispose(): void {
        liveRenderers.delete(renderer);
        renderer.dispose();
        instance.renderer = undefined;
        stateHandle.dispose();
      },
    };
  };

  return {
    name: 'fog',
    priority: -100,
    required: true,
    manager,
    configure,
    start,
    setOptions(next) {
      rendererOptions = next;
      for (const renderer of liveRenderers) renderer.setOptions(next);
    },
  };
}
