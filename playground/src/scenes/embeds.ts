import { HandTool, SelectTool, Viewport } from '@fieldnotes/core';
import type { Scene } from '../scene';
import { NAVIGATION_TOOLS, VIEWPORT_OPTIONS } from './whiteboard';

/** Embeds scene; Select and Hand only until its widgets land. */
export const embeds: Scene = {
  id: 'embeds',
  label: 'Embeds',
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
