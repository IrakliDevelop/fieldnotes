import { Viewport } from '../canvas/viewport';
import { SelectTool } from '../tools/select-tool';
import { HandTool } from '../tools/hand-tool';
import { PencilTool } from '../tools/pencil-tool';
import { EraserTool } from '../tools/eraser-tool';
import { ShapeTool } from '../tools/shape-tool';
import { ArrowTool } from '../tools/arrow-tool';
import { NoteTool } from '../tools/note-tool';
import { TextTool } from '../tools/text-tool';
import { ImageTool } from '../tools/image-tool';
import { TemplateTool } from '../tools/template-tool';
import { MeasureTool } from '../tools/measure-tool';
import type { Tool } from '../tools/types';

export interface ViewportHarness {
  viewport: Viewport;
  container: HTMLDivElement;
  wrapper: HTMLDivElement;
  cleanup: () => void;
}

export function createViewportHarness(): ViewportHarness {
  const container = document.createElement('div');
  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
  });
  document.body.appendChild(container);

  const viewport = new Viewport(container);

  const tools: Tool[] = [
    new SelectTool(),
    new HandTool(),
    new PencilTool(),
    new EraserTool(),
    new ShapeTool(),
    new ArrowTool(),
    new NoteTool(),
    new TextTool(),
    new ImageTool(),
    new TemplateTool(),
    new MeasureTool(),
  ];
  for (const tool of tools) {
    viewport.toolManager.register(tool);
  }
  viewport.toolManager.setTool('select', viewport.toolContext);

  const wrapper = container.firstElementChild as HTMLDivElement;

  return {
    viewport,
    container,
    wrapper,
    cleanup: () => {
      viewport.destroy();
      container.remove();
    },
  };
}
