// Measure tool (Phase 3)
export { MeasureTool } from './measure-tool';
export type { MeasureToolOptions, Measurement, MeasureEmission } from './measure-tool';

export { formatMeasureLabel, drawMeasurement } from './measure-render';
export type { MeasureRenderModel } from './measure-render';

export {
  RemoteMeasureOverlay,
  isMeasurePresence,
  toMeasurePresence,
  MEASURE_PRESENCE_KIND,
} from './remote-measure-overlay';
export type {
  MeasurePresence,
  RemoteMeasureOverlayHost,
  RemoteMeasureOverlayOptions,
} from './remote-measure-overlay';

// Grid (Phase 4)
export { gridElementTypeDefinition } from './grid/grid-definition';
export { GridController } from './grid/grid-controller';
export type { GridInfo, GridControllerDeps } from './grid/grid-controller';
export { GridConstraintService } from './grid/grid-constraint-service';
export { pathDistanceCells, gridDistanceCells } from './grid/grid-metric';
export type { DiagonalRule, GridMetric, PathDistance } from './grid/grid-metric';
export {
  renderSquareGrid,
  renderHexGrid,
  renderHexGridTiled,
  createHexGridTile,
  getSquareGridLines,
  getHexVertices,
  getHexCenters,
} from './grid/grid-renderer';
export type { VisibleBounds, SquareGridLines, HexVertex, HexGridTile } from './grid/grid-renderer';
export {
  getHexDistance,
  getHexCellsInRadius,
  getHexCellsInCone,
  getHexCellsInLine,
  getHexCellsInSquare,
  getHexCellsInRectangle,
  drawHexPath,
} from './grid/hex-fill';

// Template (Phase 4)
export { templateElementTypeDefinition } from './template/template-definition';
export { TemplateTool, defaultRectWidth } from './template/template-tool';
export type { TemplateToolOptions } from './template/template-tool';
export { renderTemplateFeetLabel } from './template/template-measure';
export type { TemplateFeetLabelParams } from './template/template-measure';
export { renderTemplate, emitTemplateSvg, emitGridSvg } from './template/template-renderer';

// Element types and factories (Phase 4)
export type {
  GridElement,
  HexOrientation,
  TemplateElement,
  TemplateShape,
  TemplateRenderStyle,
} from './elements/types';
export { createGrid, createTemplate } from './elements/element-factory';

// Registration
export { registerVttElementTypes } from './register';

// Fog (Phase 5)
export { createFogPlugin } from './fog/fog-plugin';
export type { FogPlugin, CreateFogPluginOptions } from './fog/fog-plugin';
export { FogManager } from './fog/fog-manager';
export type { FogManagerOptions, FogIdFactory } from './fog/fog-manager';
export { FOG_STATE_VERSION, FOG_TILE_CELLS, FOG_MAX_TILES } from './fog/types';
export type {
  FogBase,
  FogDefinitionV1,
  FogTileV1,
  FogStateV1,
  FogViewMode,
  FogOperation,
  FogRegion,
  FogToolOptions,
  FogPatch,
  FogChangeEvent,
  FogViewEvent,
} from './fog/types';
export {
  validateFogState,
  validateFogDefinition,
  validateFogTile,
  canonicalizeFogTile,
  recommendedFogCellSize,
  encodeBase64 as fogEncodeBase64,
  decodeBase64 as fogDecodeBase64,
} from './fog/tile-codec';
export { FogRenderer } from './fog/fog-renderer';
export type { FogRendererOptions } from './fog/fog-renderer';
export type {
  FogSolidStyle,
  FogProceduralStyle,
  FogStyle,
  ResolvedSolidStyle,
  ResolvedProceduralStyle,
  ResolvedFogStyle,
} from './fog/fog-style';
export { resolveFogStyle } from './fog/fog-style';
export { renderFogStylePreview } from './fog/fog-style-preview';
export { createFogPluginHandle } from './fog/fog-plugin-handle';
export { FogTool } from './fog/fog-tool';

// Fog sync types (Phase 5e)
export {
  FOG_SYNC_PROTOCOL_VERSION,
  FOG_PATCH_MAX_TILES,
  isNewerFogRecord,
  isValidFogMetaRecord,
  isValidFogTileRecord,
  isValidFogSnapshot,
  assertValidFogClientId,
} from './fog/fog-sync-types';
export type {
  FogMetaRecord,
  FogTileRecord,
  FogSnapshot,
  FogSyncManager,
  FogSyncControllerOptions,
  FogSyncControllerEvents,
  FogSyncSessionSnapshot,
  FogSyncOp,
} from './fog/fog-sync-types';
export { FogLedger } from './fog/fog-ledger';
export { FogSyncController } from './fog/fog-sync-controller';

// Fog Redis scripts (Phase 5g)
export {
  FOG_META_LWW_SCRIPT,
  FOG_PATCH_LWW_SCRIPT,
  tileIntersectsDefinition,
  parseFogRedisMetaResult,
  parseFogRedisPatchResult,
} from './fog/fog-redis-scripts';
export type { FogRedisApplyResult, FogRedisPatchApplyResult } from './fog/fog-redis-scripts';
