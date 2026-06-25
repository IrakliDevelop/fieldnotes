export const VERSION = '0.38.7';

export type { Point, StrokePoint, Size, Bounds } from './core/types';
export { snapPoint, smartSnap, snapToHexCenter } from './core/snap';
export type { CanvasState } from './core/state-serializer';
export { AutoSave } from './core/auto-save';
export type { AutoSaveOptions } from './core/auto-save';

export { Camera } from './canvas/camera';
export type { CameraOptions, CameraChangeInfo } from './canvas/camera';
export type { BackgroundOptions, BackgroundPattern } from './canvas/background';
export type { ShortcutOptions, ShortcutBindings, ShortcutsApi } from './canvas/shortcut-map';
export { Viewport } from './canvas/viewport';
export type { ViewportOptions, GridInfo, AlignEdge, DistributeAxis } from './canvas/viewport';
export { exportImage } from './canvas/export-image';
export type { ExportImageOptions } from './canvas/export-image';
export type { RenderStatsSnapshot } from './canvas/render-stats';

export { ElementStore } from './elements/element-store';
export type { ElementUpdateEvent } from './elements/element-store';
export type { FontSizePreset } from './elements/note-toolbar';
export {
  toggleBold,
  toggleItalic,
  toggleUnderline,
  toggleStrikethrough,
  setFontSize,
  getActiveFormats,
} from './elements/note-formatting';
export type { ActiveFormats } from './elements/note-formatting';
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
export { getElementBounds, boundsIntersect } from './elements/element-bounds';
export { styleToPatch, getElementStyle } from './elements/element-style';
export type { ElementStyle } from './elements/element-style';
export { getElementsBoundingBox } from './elements/bounds';
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
export { HistoryStack } from './history/history-stack';
export type { HistoryStackOptions } from './history/history-stack';

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
