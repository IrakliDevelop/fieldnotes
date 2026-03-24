export const VERSION = '0.8.3';

export { EventBus } from './core/event-bus';
export type { Point, StrokePoint, Size, Bounds } from './core/types';
export { exportState, parseState } from './core/state-serializer';
export { snapPoint } from './core/snap';
export type { CanvasState } from './core/state-serializer';
export { AutoSave } from './core/auto-save';
export type { AutoSaveOptions } from './core/auto-save';

export { Camera } from './canvas/camera';
export type { CameraOptions } from './canvas/camera';
export { Background } from './canvas/background';
export type { BackgroundOptions, BackgroundPattern } from './canvas/background';
export { InputHandler } from './canvas/input-handler';
export { Viewport } from './canvas/viewport';
export type { ViewportOptions } from './canvas/viewport';
export { exportImage } from './canvas/export-image';
export type { ExportImageOptions } from './canvas/export-image';

export { ElementStore } from './elements/element-store';
export type { ElementUpdateEvent } from './elements/element-store';
export { ElementRenderer } from './elements/element-renderer';
export { NoteEditor } from './elements/note-editor';
export { createId } from './elements/create-id';
export {
  createStroke,
  createNote,
  createArrow,
  createImage,
  createHtmlElement,
  createText,
  createShape,
  createGrid,
} from './elements/element-factory';
export {
  getArrowControlPoint,
  getArrowMidpoint,
  getBendFromPoint,
  getArrowTangentAngle,
  isNearBezier,
  getArrowBounds,
} from './elements/arrow-geometry';
export {
  isBindable,
  getElementCenter,
  getElementBounds,
  getEdgeIntersection,
  findBindTarget,
  findBoundArrows,
  updateBoundArrow,
  clearStaleBindings,
  unbindArrow,
} from './elements/arrow-binding';
export type {
  Binding,
  CanvasElement,
  ElementType,
  StrokeElement,
  NoteElement,
  ArrowElement,
  ImageElement,
  HtmlElement,
  TextElement,
  ShapeElement,
  ShapeKind,
  GridElement,
  HexOrientation,
} from './elements/types';

export type { Command } from './history/types';
export {
  AddElementCommand,
  RemoveElementCommand,
  UpdateElementCommand,
  BatchCommand,
} from './history/commands';
export { HistoryStack } from './history/history-stack';
export type { HistoryStackOptions } from './history/history-stack';
export { HistoryRecorder } from './history/history-recorder';

export { ToolManager } from './tools/tool-manager';
export { HandTool } from './tools/hand-tool';
export { PencilTool } from './tools/pencil-tool';
export type { PencilToolOptions } from './tools/pencil-tool';
export { EraserTool } from './tools/eraser-tool';
export type { EraserToolOptions } from './tools/eraser-tool';
export { SelectTool } from './tools/select-tool';
export { ArrowTool } from './tools/arrow-tool';
export type { ArrowToolOptions } from './tools/arrow-tool';
export { NoteTool } from './tools/note-tool';
export type { NoteToolOptions } from './tools/note-tool';
export { TextTool } from './tools/text-tool';
export type { TextToolOptions } from './tools/text-tool';
export { ImageTool } from './tools/image-tool';
export type { ImageToolOptions } from './tools/image-tool';
export { ShapeTool } from './tools/shape-tool';
export type { ShapeToolOptions } from './tools/shape-tool';
export type { Tool, ToolContext, PointerState, ToolName } from './tools/types';

export { LayerManager } from './layers/layer-manager';
export type { Layer } from './layers/types';
export {
  CreateLayerCommand,
  RemoveLayerCommand,
  UpdateLayerCommand,
} from './history/layer-commands';
