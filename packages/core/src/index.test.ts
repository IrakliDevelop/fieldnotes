import { describe, it, expect } from 'vitest';
import * as FN from './index';

describe('core public surface', () => {
  it('exports the current version', () => {
    expect(FN.VERSION).toBe('0.64.0');
  });

  it('exports the shared-ruler surface', () => {
    expect(FN.RemoteMeasureOverlay).toBeTypeOf('function');
    expect(FN.isMeasurePresence).toBeTypeOf('function');
    expect(FN.toMeasurePresence).toBeTypeOf('function');
    expect(FN.MEASURE_PRESENCE_KIND).toBe('measure');
  });

  it('exports the camera view, animator, and focus presence surface', () => {
    expect(typeof FN.captureCameraView).toBe('function');
    expect(typeof FN.fitZoomForView).toBe('function');
    expect(typeof FN.cameraOriginForView).toBe('function');
    expect(typeof FN.applyCameraView).toBe('function');
    expect(typeof FN.CameraAnimator).toBe('function');
    expect(typeof FN.isFocusPresence).toBe('function');
    expect(typeof FN.toFocusPresence).toBe('function');
    expect(FN.FOCUS_PRESENCE_KIND).toBe('focus');
    expect(typeof FN.RemoteFocusReceiver).toBe('function');
  });

  it('does not export internal machinery (trimmed before 1.0)', () => {
    const removed = [
      'ElementRenderer',
      'InputHandler',
      'InputFilter',
      'DoubleTapDetector',
      'NoteEditor',
      'NoteToolbar',
      'ContextMenu',
      'Background',
      'EventBus',
      'Quadtree',
      'HistoryRecorder',
      'AddElementCommand',
      'RemoveElementCommand',
      'UpdateElementCommand',
      'BatchCommand',
      'CreateLayerCommand',
      'RemoveLayerCommand',
      'UpdateLayerCommand',
      'isBindable',
      'getElementCenter',
      'getEdgeIntersection',
      'findBindTarget',
      'findBoundArrows',
      'updateBoundArrow',
      'clearStaleBindings',
      'unbindArrow',
      'createId',
      'formatId',
      'randomClientComponent',
      'sanitizeNoteHtml',
      'isNoteContentEmpty',
      'DEFAULT_FONT_SIZE_PRESETS',
      'exportState',
      'parseState',
      // internal helpers that must stay off the public surface
      'translateElementPatch',
      'computeSnapGuides',
      'expandToGroups',
      'rotatePoint',
      'rotatedAABB',
      'normalizeAngle',
      'withRotation',
      // select-tool decomposition internals
      'getOverlayLayout',
      'hitTestResizeHandle',
      'computeRotatedResize',
      // viewport decomposition internals
      'SelectionOps',
      'GridController',
      'createWrapper',
      'ViewportInteractions',
      // element-renderer decomposition internals
      'renderStroke',
      'renderTemplate',
      'templateAimKnob',
      'hitTestTemplateAimHandle',
      'renderTemplateFeetLabel',
      // template-tool and select-resize rectangle internals
      'hitTestRectangleLengthHandle',
      'hitTestRectangleWidthHandle',
      'computeRectangleLengthResize',
      'computeRectangleWidthResize',
      'defaultRectWidth',
      // input-handler decomposition internals
      'KeyboardHandler',
      // pan-inertia controller internal
      'PanInertia',
      // minimap internals
      'Minimap',
      'computeMinimapTransform',
      // selection-rotate internals
      'rotationPivot',
      'rotateElementPatch',
      'unionBounds',
      'BoundedElement',
      // canvas-routed html painting and element-activation internals
      'paintHtmlElement',
      'HtmlPaintDiagnosticDeduper',
      'ElementActivation',
      'DEFAULT_ACTIVATION_SLOP_PX',
      'DEFAULT_ACTIVATION_DOUBLE_DELAY_MS',
    ];
    for (const name of removed) {
      expect(name in FN, `${name} should not be exported`).toBe(false);
    }
  });

  it('keeps the tier-1 surface and reusable helpers', () => {
    const kept = [
      'Viewport',
      'AutoSave',
      'MemoryAdapter',
      'LocalStorageAdapter',
      'IndexedDBAdapter',
      'exportImage',
      'exportSvg',
      'Camera',
      'MinimapController',
      'ElementStore',
      'LayerManager',
      'ToolManager',
      'HistoryStack',
      'HandTool',
      'PencilTool',
      'EraserTool',
      'SelectTool',
      'ArrowTool',
      'NoteTool',
      'TextTool',
      'ImageTool',
      'ShapeTool',
      'LaserTool',
      'MeasureTool',
      'TemplateTool',
      'PingTool',
      'PingInput',
      'RemotePingOverlay',
      'createStroke',
      'createNote',
      'createArrow',
      'createGrid',
      'createTemplate',
      'snapPoint',
      'smartSnap',
      'snapToHexCenter',
      'getHexCellsInRadius',
      'getHexCellsInRectangle',
      'drawHexPath',
      'getArrowControlPoint',
      'getArrowBounds',
      'getElementBounds',
      'getElementsBoundingBox',
      'toggleBold',
      'getActiveFormats',
      'styleToPatch',
      'getElementStyle',
    ];
    for (const name of kept) {
      expect(name in FN, `${name} should be exported`).toBe(true);
    }
  });

  it('exports the html painter and activation surface', async () => {
    const api = await import('./index');
    for (const name of ['HtmlPainterRegistry', 'resolveHtmlRouting', 'HtmlPainterMissingError']) {
      expect(api).toHaveProperty(name);
    }
  });

  it('exposes the viewport html-painter and activation methods', async () => {
    const { Viewport } = await import('./index');
    for (const method of [
      'getHtmlPainters',
      'expectCanvasHtmlTypes',
      'registerHtmlPainter',
      'onHtmlPaintDiagnostic',
      'setActivation',
      'onElementActivate',
    ]) {
      expect(typeof Viewport.prototype[method as keyof Viewport]).toBe('function');
    }
  });

  it('exports the element rect tracking surface', async () => {
    const FN = await import('./index');
    expect(typeof FN.ElementRectTracker).toBe('function');
    expect(typeof FN.computeElementRects).toBe('function');
    expect(typeof FN.elementRectsEqual).toBe('function');
  });

  it('reports VERSION 0.64.0', async () => {
    const { VERSION } = await import('./index');
    expect(VERSION).toBe('0.64.0');
  });

  it('exports the movement-path surface', () => {
    expect(FN.PathTool).toBeTypeOf('function');
    expect(FN.pathDistanceCells).toBeTypeOf('function');
    expect(FN.gridDistanceCells).toBeTypeOf('function');
    expect(FN.snapToCellCenter).toBeTypeOf('function');
    expect(FN.snapFootprintCenter).toBeTypeOf('function');
    expect(FN.RemotePathOverlay).toBeTypeOf('function');
    expect(FN.isPathPresence).toBeTypeOf('function');
    expect(FN.toPathPresence).toBeTypeOf('function');
    expect(FN.PATH_PRESENCE_KIND).toBe('path');
  });
  it('keeps the path renderer and linger overlay internal', () => {
    expect((FN as Record<string, unknown>).drawPath).toBeUndefined();
    expect((FN as Record<string, unknown>).LingerOverlay).toBeUndefined();
  });
});
