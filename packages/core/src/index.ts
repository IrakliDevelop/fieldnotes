export const VERSION = '0.64.0';

export type { Point, StrokePoint, Size, Bounds } from './core/types';
export {
  snapPoint,
  smartSnap,
  snapToHexCenter,
  snapToCellCenter,
  snapFootprintCenter,
} from './core/snap';
export type { Footprint } from './core/snap';
export { pathDistanceCells, gridDistanceCells } from './core/grid-metric';
export type { DiagonalRule, GridMetric, PathDistance } from './core/grid-metric';
export type { CanvasState } from './core/state-serializer';
export { AutoSave } from './core/auto-save';
export type { AutoSaveOptions } from './core/auto-save';
export { MemoryAdapter } from './core/storage/memory-adapter';
export { LocalStorageAdapter } from './core/storage/local-storage-adapter';
export { IndexedDBAdapter } from './core/storage/indexeddb-adapter';
export type { StorageAdapter } from './core/storage/storage-adapter';
export type { IndexedDBAdapterOptions } from './core/storage/indexeddb-adapter';

export { Camera } from './canvas/camera';
export type { CameraOptions, CameraChangeInfo } from './canvas/camera';
export type { BackgroundOptions, BackgroundPattern } from './canvas/background';
export type { ShortcutOptions, ShortcutBindings, ShortcutsApi } from './canvas/shortcut-map';
export { Viewport } from './canvas/viewport';
export type {
  ViewportOptions,
  GridInfo,
  AlignEdge,
  DistributeAxis,
  RotateDirection,
} from './canvas/viewport';
export {
  ElementRectTracker,
  computeElementRects,
  elementRectsEqual,
} from './canvas/element-rect-tracker';
export type {
  ElementRect,
  ElementRectMatch,
  ElementRectMatchError,
  ElementRectTrackerOptions,
  RectTrackerHost,
} from './canvas/element-rect-tracker';
export type { HitTestOptions } from './canvas/viewport';
export { exportImage } from './canvas/export-image';
export type {
  ExportAssetError,
  ExportAssetErrorReason,
  ExportImageOptions,
  ExportResourceOptions,
} from './canvas/export-image';
export { exportSvg } from './canvas/export-svg';
export type { ExportSvgOptions } from './canvas/export-svg';
export type {
  HtmlExportError,
  HtmlExportErrorReason,
  HtmlExportOptions,
  HtmlExportRenderer,
} from './canvas/html-export';
export type { RenderStatsSnapshot } from './canvas/render-stats';
export type { OverlayRenderer } from './canvas/render-loop';
export {
  RemoteLaserOverlay,
  isLaserTrailPresence,
  toLaserTrailPresence,
  LASER_TRAIL_PRESENCE_KIND,
} from './canvas/remote-laser-overlay';
export type {
  LaserTrailPresence,
  RemoteLaserOverlayHost,
  RemoteLaserOverlayOptions,
} from './canvas/remote-laser-overlay';
export {
  RemotePingOverlay,
  isPingPresence,
  toPingPresence,
  PING_PRESENCE_KIND,
} from './canvas/remote-ping-overlay';
export type {
  PingPresence,
  RemotePingOverlayHost,
  RemotePingOverlayOptions,
} from './canvas/remote-ping-overlay';
export {
  RemoteMeasureOverlay,
  isMeasurePresence,
  toMeasurePresence,
  MEASURE_PRESENCE_KIND,
} from './canvas/remote-measure-overlay';
export type {
  MeasurePresence,
  RemoteMeasureOverlayHost,
  RemoteMeasureOverlayOptions,
} from './canvas/remote-measure-overlay';
export {
  RemotePathOverlay,
  isPathPresence,
  toPathPresence,
  PATH_PRESENCE_KIND,
  PATH_PRESENCE_MAX_POINTS,
} from './canvas/remote-path-overlay';
export type {
  PathPresence,
  RemotePathOverlayHost,
  RemotePathOverlayOptions,
} from './canvas/remote-path-overlay';
export { PingInput } from './canvas/ping-input';
export type { PingInputHost, PingInputOptions } from './canvas/ping-input';
export { MinimapController } from './canvas/minimap-controller';
export type { MinimapControllerOptions } from './canvas/minimap-controller';
export {
  captureCameraView,
  fitZoomForView,
  cameraOriginForView,
  applyCameraView,
} from './canvas/camera-view';
export type { CameraView } from './canvas/camera-view';
export { CameraAnimator } from './canvas/camera-animator';
export type {
  CameraAnimatorOptions,
  CameraAnimationEndReason,
  FrameScheduler,
} from './canvas/camera-animator';
export { isFocusPresence, toFocusPresence, FOCUS_PRESENCE_KIND } from './canvas/focus-presence';
export type { FocusPresence, FocusAudience } from './canvas/focus-presence';
export { RemoteFocusReceiver } from './canvas/remote-focus-receiver';
export type {
  FocusRole,
  RemoteFocusReceiverHost,
  RemoteFocusReceiverOptions,
} from './canvas/remote-focus-receiver';
export {
  HtmlPainterRegistry,
  HtmlPainterMissingError,
  resolveHtmlRouting,
} from './canvas/html-painter-registry';
export type { HtmlPaintContext, HtmlPainter, HtmlRouting } from './canvas/html-painter-registry';
export type { HtmlPaintDiagnostic, HtmlRenderTarget } from './canvas/html-paint-diagnostics';
export type { ElementActivationEvent, ActivationOptions } from './canvas/element-activation';

export { ElementStore } from './elements/element-store';
export type { ElementUpdateEvent } from './elements/element-store';
export type { ElementChangeMeta } from './elements/element-store';
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
export type { SelectionStyleDetails } from './canvas/selection-ops';
export { getElementsBoundingBox } from './elements/bounds';
export {
  getHexDistance,
  getHexCellsInRadius,
  getHexCellsInCone,
  getHexCellsInLine,
  getHexCellsInSquare,
  getHexCellsInRectangle,
  drawHexPath,
} from './elements/hex-fill';
export type {
  Binding,
  CanvasElement,
  ElementType,
  StrokeElement,
  NoteElement,
  ArrowElement,
  ArrowStrokeStyle,
  ImageElement,
  HtmlElement,
  TextElement,
  ShapeElement,
  ShapeKind,
  GridElement,
  HexOrientation,
  TemplateElement,
  TemplateShape,
  TemplateRenderStyle,
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
export type { MeasureToolOptions, Measurement, MeasureEmission } from './tools/measure-tool';
export { PathTool } from './tools/path-tool';
export type {
  PathToolOptions,
  PathAnchor,
  PathRangeBand,
  PathSegment,
  PathEmission,
} from './tools/path-tool';
export { TemplateTool } from './tools/template-tool';
export type { TemplateToolOptions } from './tools/template-tool';
export { LaserTool } from './tools/laser-tool';
export type { LaserToolOptions, LaserTrailEmission } from './tools/laser-tool';
export { PingTool } from './tools/ping-tool';
export type { PingToolOptions, PingEmission } from './tools/ping-tool';
export type { Tool, ToolContext, PointerState, ToolName } from './tools/types';

export { LayerManager } from './layers/layer-manager';
export type { Layer } from './layers/types';
