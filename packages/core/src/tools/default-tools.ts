import type { Tool } from './types';
import { HandTool } from './hand-tool';
import { SelectTool } from './select-tool';
import { PencilTool } from './pencil-tool';
import { EraserTool } from './eraser-tool';
import { ArrowTool } from './arrow-tool';
import { NoteTool } from './note-tool';
import { TextTool } from './text-tool';
import { ShapeTool } from './shape-tool';
import { FrameTool } from './frame-tool';

/** Fresh instances of the standard board tools. */
export function createDefaultTools(): Tool[] {
  return [
    new HandTool(),
    new SelectTool(),
    new PencilTool(),
    new EraserTool(),
    new ArrowTool(),
    new NoteTool(),
    new TextTool(),
    new ShapeTool(),
    new FrameTool(),
  ];
}
