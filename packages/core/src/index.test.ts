import { describe, it, expect } from 'vitest';
import * as FN from './index';

describe('core public surface', () => {
  it('exports the current version', () => {
    expect(FN.VERSION).toBe('0.27.0');
  });

  it('does not export internal machinery (trimmed before 1.0)', () => {
    const removed = [
      'ElementRenderer',
      'InputHandler',
      'InputFilter',
      'DoubleTapDetector',
      'NoteEditor',
      'NoteToolbar',
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
      'sanitizeNoteHtml',
      'isNoteContentEmpty',
      'DEFAULT_FONT_SIZE_PRESETS',
      'exportState',
      'parseState',
    ];
    for (const name of removed) {
      expect(name in FN, `${name} should not be exported`).toBe(false);
    }
  });

  it('keeps the tier-1 surface and reusable helpers', () => {
    const kept = [
      'Viewport',
      'AutoSave',
      'exportImage',
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
