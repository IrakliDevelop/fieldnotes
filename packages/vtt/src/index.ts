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

// Grid (Phase 4) — re-exported from core, registration via registerVttElementTypes()
export { gridElementTypeDefinition } from '@fieldnotes/core';
export { GridController } from './grid/grid-controller';
export type { GridInfo, GridControllerDeps } from './grid/grid-controller';
export { GridConstraintService } from './grid/grid-constraint-service';
export { pathDistanceCells, gridDistanceCells } from './grid/grid-metric';
export type { DiagonalRule, GridMetric, PathDistance } from './grid/grid-metric';

// Template (Phase 4) — re-exported from core, registration via registerVttElementTypes()
export { templateElementTypeDefinition } from '@fieldnotes/core';
export { TemplateTool, defaultRectWidth } from './template/template-tool';
export type { TemplateToolOptions } from './template/template-tool';

// Registration
export { registerVttElementTypes } from './register';
