import type { Tool } from './types';
import { HandTool } from './hand-tool';
import { SelectTool } from './select-tool';
import { PencilTool } from './pencil-tool';
import { EraserTool } from './eraser-tool';
import { ArrowTool } from './arrow-tool';
import { NoteTool } from './note-tool';
import { TextTool } from './text-tool';
import { ShapeTool } from './shape-tool';

/** Fresh instances of the standard board tools: hand, select, pencil, eraser, arrow, note, text, shape. */
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
  ];
}
