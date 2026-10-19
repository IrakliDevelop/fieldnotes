import { HandTool, NoteTool, PencilTool, SelectTool, TextTool, Viewport } from '@fieldnotes/core';
import { buildEmbedsSample } from '../samples/embeds';
import type { Scene, ToolSpec } from '../scene';
import { InsertTool } from '../tools/insert-tool';
import { registerWidgets, WIDGETS } from '../widgets';
import { CONTROLS, NAVIGATION_TOOLS, VIEWPORT_OPTIONS } from './whiteboard';

/** Interactive HTML widgets placed from the Insert flyout. */
export const embeds: Scene = {
  id: 'embeds',
  label: 'Embeds',
  mount({ stage, shell }) {
    const viewport = new Viewport(stage, {
      ...VIEWPORT_OPTIONS,
      tools: [new SelectTool(), new HandTool(), new NoteTool(), new TextTool(), new PencilTool()],
    });
    const [firstWidget] = WIDGETS;
    if (!firstWidget) throw new Error('No widgets registered');
    const insertTool = new InsertTool(viewport, firstWidget);
    viewport.toolManager.register(insertTool);
    const unregister = registerWidgets(viewport, shell.toast);

    const tools: readonly ToolSpec[] = [
      ...NAVIGATION_TOOLS,
      {
        name: 'insert',
        label: 'Insert',
        icon: 'insert',
        key: '3',
        flyout: WIDGETS.map((def) => ({
          id: def.htmlType,
          label: def.label,
          icon: def.icon,
          select: () => insertTool.setWidget(def),
        })),
      },
      { name: 'note', label: 'Note', icon: 'note', key: '4' },
      { name: 'text', label: 'Text', icon: 'text', key: '5' },
      { name: 'pencil', label: 'Pencil', icon: 'pencil', key: '6' },
    ];

    return {
      viewport,
      tools,
      styles: { controlsFor: (toolName) => CONTROLS[toolName] ?? [] },
      loadSample: () => buildEmbedsSample(viewport),
      dispose: () => {
        unregister();
        viewport.destroy();
      },
    };
  },
};
