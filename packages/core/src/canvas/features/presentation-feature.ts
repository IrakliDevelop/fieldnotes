import {
  createPresentationActions,
  framePresentationSlides,
  PresentationMode,
} from '../presentation';
import type { PresentationApi } from '../presentation';
import { featureHostOf, INERT_PRESENTATION } from '../feature-host';
import type { ViewportPlugin } from '../viewport-plugin';

interface Slot {
  mode: PresentationApi;
}

/** Presentation mode and its `presentation.*` actions; install it to use `viewport.presentation`. */
export function presentationFeature(): ViewportPlugin {
  // One viewport's configure and start run in the same constructor, so start claims the latest slot.
  let latest: Slot = { mode: INERT_PRESENTATION };
  return {
    name: 'fieldnotes:presentation',
    required: true,
    priority: -1000,
    configure: (context) => {
      const slot: Slot = { mode: INERT_PRESENTATION };
      latest = slot;
      // Actions register in configure, before the mode exists in start.
      const current: PresentationApi = {
        getState: () => slot.mode.getState(),
        getSlides: () => slot.mode.getSlides(),
        start: (options) => slot.mode.start(options),
        exit: () => slot.mode.exit(),
        next: () => slot.mode.next(),
        previous: () => slot.mode.previous(),
        goTo: (index) => slot.mode.goTo(index),
        onChange: (listener) => slot.mode.onChange(listener),
      };
      for (const action of createPresentationActions(current)) context.registerAction(action);
    },
    start: ({ viewport, addDisposer }) => {
      const slot = latest;
      const host = featureHostOf(viewport);
      const created = new PresentationMode({
        container: host.container,
        wrapper: host.wrapper,
        camera: viewport.camera,
        getCanvasSize: () => viewport.getCanvasSize(),
        defaultSlides: () =>
          framePresentationSlides(viewport.store, (id) => viewport.layerManager.isLayerVisible(id)),
        onResize: (listener) => viewport.onResize(listener),
        activeToolName: () => viewport.toolManager.activeTool?.name ?? null,
        setTool: (name) => host.actions.run('tool.' + name, { source: 'api' }),
        clearSelection: () => host.clearSelection(),
        stopCameraMotion: () => host.stopCameraMotion(),
        hasOpenOverlay: () => host.hasOpenOverlay(),
      });
      slot.mode = created;
      host.setPresentation(created);
      addDisposer(() => {
        host.setPresentation(null);
        created.destroy();
        slot.mode = INERT_PRESENTATION;
      });
      return undefined;
    },
  };
}
