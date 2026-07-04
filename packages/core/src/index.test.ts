import { describe, it, expect } from 'vitest';
import * as FN from './index';

describe('core public surface', () => {
  it('exports the current version', () => {
    expect(FN.VERSION).toBe('0.46.1');
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
      // input-handler decomposition internals
      'KeyboardHandler',
      // pan-inertia controller internal
      'PanInertia',
      // minimap internals
      'Minimap',
      'computeMinimapTransform',
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
      'createStroke',
      'createNote',
      'createArrow',
      'createGrid',
      'createTemplate',
      'snapPoint',
      'smartSnap',
      'snapToHexCenter',
      'getHexCellsInRadius',
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
});
