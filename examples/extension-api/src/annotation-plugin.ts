import { createServiceKey } from '@fieldnotes/core';
import type {
  ViewportPlugin,
  PluginStartContext,
  PluginConfigureContext,
  ExtensionElementEnvelope,
} from '@fieldnotes/core';
import { annotationDefinition } from './annotation-element';

// ─── 1. Define a typed service key ───────────────────────────────────────────────
// Services are how plugins expose functionality to other plugins and to the
// host application. The key is an opaque branded token — safe to share without
// risk of collision.

export interface AnnotationService {
  /** Number of annotation elements currently on the canvas. */
  readonly count: number;
  /** The colors used by placed annotations. */
  readonly colors: readonly string[];
}

export const AnnotationServiceKey = createServiceKey<AnnotationService>('example:annotations');

// ─── 2. Define the viewport plugin ────────────────────────────────────────────
// Plugins have two lifecycle phases:
//   configure — register element types, tools, and render hooks (no runtime access)
//   start     — access store, camera, services; return a dispose handle

export const annotationPlugin: ViewportPlugin = {
  name: 'annotations',

  configure(ctx: PluginConfigureContext): void {
    // Register the custom element type so the serializer, store, and renderer
    // all know how to handle 'example:annotation' elements.
    ctx.registerElementType(annotationDefinition);

    // Register viewport render hooks to draw an overlay behind all elements.
    ctx.registerViewportHooks({
      afterElements(ctx2d, _elements, dims) {
        // Draw a subtle watermark at the bottom-right corner
        ctx2d.save();
        ctx2d.font = '12px system-ui';
        ctx2d.fillStyle = 'rgba(0,0,0,0.08)';
        ctx2d.textAlign = 'right';
        ctx2d.textBaseline = 'bottom';
        ctx2d.fillText('Extension API Example', dims.width - 8, dims.height - 8);
        ctx2d.restore();
      },
    });
  },

  start(ctx: PluginStartContext) {
    // Track annotation count reactively by scanning the store.
    function getAnnotations() {
      return ctx.store
        .getAll()
        .filter(
          (el): el is ExtensionElementEnvelope =>
            el.type === 'extension' && el.extensionType === 'example:annotation',
        );
    }

    // Register the typed service so other code can access it via the viewport.
    ctx.registerService(AnnotationServiceKey, {
      get count() {
        return getAnnotations().length;
      },
      get colors() {
        return getAnnotations().map((el) => el.data['color'] as string);
      },
    });

    // Request a re-render whenever elements change so the watermark updates.
    ctx.onChange(() => ctx.requestRender());

    // Return a dispose handle — called when the viewport is destroyed.
    return {
      dispose() {
        // Cleanup: unsubscribe, clear intervals, etc.
      },
    };
  },
};
