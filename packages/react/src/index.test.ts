import { describe, expect, it } from 'vitest';
import * as R from './index';
import type {
  ActivationOptions,
  AttachAwarenessOptions,
  AwarenessFields,
  Bounds,
  CameraView,
  CanvasSize,
  CanvasState,
  ElementActivationEvent,
  ExportImageOptions,
  ExportSvgOptions,
  HistoryState,
  HostElementGeometry,
  ImportableCanvasState,
  Layer,
  LayersState,
  MountAutoSaveOptions,
  Peer,
  Point,
  PointerState,
  PresenceChannel,
  SelectionOpsState,
  ShortcutBindings,
  Tool,
  ToolContext,
  Viewport,
  ViewportOptions,
} from './index';

const point: Point = { x: 0, y: 0 };
const bounds: Bounds = { x: 0, y: 0, w: 0, h: 0 };
const bindings = { 'edit.undo': ['mod+z'] } satisfies ShortcutBindings;
const canvasSize: CanvasSize = { w: 0, h: 0 };
const geometry: HostElementGeometry = { position: point, size: canvasSize };
const noop = () => {
  void 0;
};
const viewportOptions = { toolbar: true } satisfies ViewportOptions;
const pointerState = {
  x: 0,
  y: 0,
  pressure: 0,
  pointerType: 'mouse',
  shiftKey: false,
} satisfies PointerState;
const tool: Tool = {
  name: 'test',
  onPointerDown: noop,
  onPointerMove: noop,
  onPointerUp: noop,
};
const layer = {
  id: 'layer',
  name: 'Layer',
  visible: true,
  locked: false,
  order: 0,
  opacity: 1,
} satisfies Layer;
const canvasState = {
  version: 6,
  camera: { position: point, zoom: 1 },
  elements: [],
} satisfies CanvasState;
const importableCanvasState: ImportableCanvasState = canvasState;
const historyState = { canUndo: false, canRedo: false } satisfies HistoryState;
const layersState = { layers: [layer], activeLayerId: layer.id } satisfies LayersState;
const selectionOpsState = {
  selectedIds: [],
  canGroup: false,
  canUngroup: false,
  canAlign: false,
  canDistribute: false,
  isLocked: null,
} satisfies SelectionOpsState;
const activationOptions = { gesture: 'single' } satisfies ActivationOptions;
const exportImageOptions = { padding: 0 } satisfies ExportImageOptions;
const exportSvgOptions = { padding: 0 } satisfies ExportSvgOptions;
const cameraView = { x: 0, y: 0, w: 1, h: 1 } satisfies CameraView;
const peer: Peer = {
  from: 'peer',
  id: 'peer',
  cursor: point,
  selection: [],
  tool: null,
};
const presenceChannel: PresenceChannel = {
  sendPresence: noop,
  onPresence: () => noop,
  onPresenceLeave: () => noop,
};
const attachAwarenessOptions = { identity: { id: 'peer' } } satisfies AttachAwarenessOptions;
const awarenessFields = { cursor: true, selection: false, tool: true } satisfies AwarenessFields;
const mountAutoSaveOptions = { key: 'fieldnotes' } satisfies MountAutoSaveOptions;

function readViewport(viewport: Viewport): number {
  return viewport.camera.zoom;
}

function readToolContext(context: ToolContext): () => void {
  return context.requestRender;
}

function createElementActivationEvent(
  element: ElementActivationEvent['element'],
): ElementActivationEvent {
  return { element, world: point, pointerType: 'mouse', gesture: 'single' };
}

void [
  bounds,
  bindings,
  canvasSize,
  geometry,
  viewportOptions,
  pointerState,
  tool,
  canvasState,
  importableCanvasState,
  layer,
  historyState,
  layersState,
  selectionOpsState,
  activationOptions,
  exportImageOptions,
  exportSvgOptions,
  cameraView,
  peer,
  presenceChannel,
  attachAwarenessOptions,
  awarenessFields,
  mountAutoSaveOptions,
  readViewport,
  readToolContext,
  createElementActivationEvent,
];

describe('package index', () => {
  it.each([
    'FieldNotesCanvas',
    'HostElement',
    'CanvasElement',
    'Minimap',
    'ViewportContext',
    'useViewport',
    'useActiveTool',
    'useCamera',
    'useCameraControls',
    'useToolOptions',
    'useLayers',
    'useHistory',
    'useElements',
    'useElement',
    'useSelection',
    'useSelectionStyle',
    'useSelectionStyleDetails',
    'useSelectionOps',
    'useElementRects',
    'useExport',
    'useLoad',
    'useTransaction',
    'useCanvasSize',
    'useShortcuts',
    'usePresence',
  ] satisfies (keyof typeof R)[])('exports %s as a runtime value', (name) => {
    expect(['function', 'object']).toContain(typeof R[name]);
  });
});
