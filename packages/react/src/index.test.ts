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
const bindings: ShortcutBindings = {};
const canvasSize: CanvasSize = { w: 0, h: 0 };
const geometry: HostElementGeometry = { position: point, size: canvasSize };

interface D12Types {
  viewport: Viewport;
  viewportOptions: ViewportOptions;
  tool: Tool;
  toolContext: ToolContext;
  pointerState: PointerState;
  canvasState: CanvasState;
  importableCanvasState: ImportableCanvasState;
  layer: Layer;
  historyState: HistoryState;
  layersState: LayersState;
  selectionOpsState: SelectionOpsState;
  activationOptions: ActivationOptions;
  elementActivationEvent: ElementActivationEvent;
  exportImageOptions: ExportImageOptions;
  exportSvgOptions: ExportSvgOptions;
  cameraView: CameraView;
  peer: Peer;
  presenceChannel: PresenceChannel;
  attachAwarenessOptions: AttachAwarenessOptions;
  awarenessFields: AwarenessFields;
  mountAutoSaveOptions: MountAutoSaveOptions;
}

function acceptsD12Types(value: D12Types): D12Types {
  return value;
}

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

  it('keeps host geometry values usable', () => {
    expect(geometry.position).toEqual(point);
    expect(bounds.w).toBe(0);
    expect(bindings).toEqual({});
    expect(canvasSize).toEqual({ w: 0, h: 0 });
    expect(acceptsD12Types).toBeTypeOf('function');
  });
});
