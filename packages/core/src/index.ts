export const VERSION = '0.9.0';

export { EventBus } from './core/event-bus';
export { Quadtree } from './core/quadtree';
export type { Point, StrokePoint, Size, Bounds } from './core/types';
export { exportState, parseState } from './core/state-serializer';
export { snapPoint, smartSnap, snapToHexCenter } from './core/snap';
export type { CanvasState } from './core/state-serializer';
export { AutoSave } from './core/auto-save';
export type { AutoSaveOptions } from './core/auto-save';

export { Camera } from './canvas/camera';
export type { CameraOptions, CameraChangeInfo } from './canvas/camera';
export { Background } from './canvas/background';
export type { BackgroundOptions, BackgroundPattern } from './canvas/background';
export { InputHandler } from './canvas/input-handler';
export { Viewport } from './canvas/viewport';
export type { ViewportOptions } from './canvas/viewport';
export { exportImage } from './canvas/export-image';
export type { ExportImageOptions } from './canvas/export-image';
export type { RenderStatsSnapshot } from './canvas/render-stats';

export { ElementStore } from './elements/element-store';
export type { ElementUpdateEvent } from './elements/element-store';
export { ElementRenderer } from './elements/element-renderer';
export { NoteEditor } from './elements/note-editor';
export type { NoteEditorOptions } from './elements/note-editor';
export { sanitizeNoteHtml } from './elements/note-sanitizer';
export type { StyledRun } from './elements/note-sanitizer';
export { NoteToolbar, DEFAULT_FONT_SIZE_PRESETS } from './elements/note-toolbar';
export type { FontSizePreset } from './elements/note-toolbar';
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
  createTemplate,
  DEFAULT_NOTE_FONT_SIZE,
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
  getEdgeIntersection,
  findBindTarget,
  findBoundArrows,
  updateBoundArrow,
  clearStaleBindings,
  unbindArrow,
} from './elements/arrow-binding';
export { getElementBounds, boundsIntersect } from './elements/element-bounds';
export {
  getHexDistance,
  getHexCellsInRadius,
  getHexCellsInCone,
  getHexCellsInLine,
  getHexCellsInSquare,
  drawHexPath,
} from './elements/hex-fill';
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
  TemplateElement,
  TemplateShape,
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
export { MeasureTool } from './tools/measure-tool';
export type { MeasureToolOptions, Measurement } from './tools/measure-tool';
export { TemplateTool } from './tools/template-tool';
export type { TemplateToolOptions } from './tools/template-tool';
export type { Tool, ToolContext, PointerState, ToolName } from './tools/types';

export { LayerManager } from './layers/layer-manager';
export type { Layer } from './layers/types';
export {
  CreateLayerCommand,
  RemoveLayerCommand,
  UpdateLayerCommand,
} from './history/layer-commands';
