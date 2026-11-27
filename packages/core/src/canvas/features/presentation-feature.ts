import {
  createPresentationActions,
  framePresentationSlides,
  PresentationMode,
} from '../presentation';
import type { PresentationApi } from '../presentation';
import { featureHostOf, INERT_PRESENTATION } from '../feature-host';
import type { ViewportPlugin } from '../viewport-plugin';

/** Presentation mode and its `presentation.*` actions; install it to use `viewport.presentation`. */
export function presentationFeature(): ViewportPlugin {
  let mode: PresentationApi = INERT_PRESENTATION;
  // Actions register in configure, before the mode exists in start.
  const current: PresentationApi = {
    getState: () => mode.getState(),
    getSlides: () => mode.getSlides(),
    start: (options) => mode.start(options),
    exit: () => mode.exit(),
    next: () => mode.next(),
    previous: () => mode.previous(),
    goTo: (index) => mode.goTo(index),
    onChange: (listener) => mode.onChange(listener),
  };
  return {
    name: 'fieldnotes:presentation',
    required: true,
    priority: -1000,
    configure: (context) => {
      for (const action of createPresentationActions(current)) context.registerAction(action);
    },
    start: ({ viewport, addDisposer }) => {
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
      mode = created;
      host.setPresentation(created);
      addDisposer(() => {
        host.setPresentation(null);
        created.destroy();
        mode = INERT_PRESENTATION;
      });
      return undefined;
    },
  };
}
