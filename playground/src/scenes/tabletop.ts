import { HandTool, SelectTool, Viewport } from '@fieldnotes/core';
import type { Scene } from '../scene';
import { NAVIGATION_TOOLS, VIEWPORT_OPTIONS } from './whiteboard';

/** Tabletop scene; Select and Hand only until its VTT tools land. */
export const tabletop: Scene = {
  id: 'tabletop',
  label: 'Tabletop',
  mount({ stage }) {
    const viewport = new Viewport(stage, {
      ...VIEWPORT_OPTIONS,
      tools: [new SelectTool(), new HandTool()],
    });
    return {
      viewport,
      tools: NAVIGATION_TOOLS,
      styles: { controlsFor: () => [] },
      loadSample: () => {
        // This scene has no sample board yet.
      },
      dispose: () => viewport.destroy(),
    };
  },
};
