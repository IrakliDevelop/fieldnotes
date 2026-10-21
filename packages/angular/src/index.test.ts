import { describe, expect, expectTypeOf, it } from 'vitest';
import type * as core from '@fieldnotes/core';
import * as api from './index';
import type * as types from './index';
import type { InjectHistoryResult } from './helpers/inject-history';
import type { InjectLayersResult } from './helpers/inject-layers';
import type { InjectSelectionOpsResult } from './helpers/inject-selection-ops';

describe('public surface', () => {
  it('exports exactly the components, token and helpers', () => {
    expect(Object.keys(api).sort()).toEqual([
      'CanvasElement',
      'FIELDNOTES_VIEWPORT',
      'FieldNotesCanvas',
      'Minimap',
      'injectActiveTool',
      'injectCamera',
      'injectElementRects',
      'injectElements',
      'injectHistory',
      'injectLayers',
      'injectSelection',
      'injectSelectionOps',
      'injectSelectionStyle',
      'injectSelectionStyleDetails',
      'injectToolOptions',
      'injectViewport',
    ]);
  });

  it('keeps the internal helpers private', () => {
    expect(api).not.toHaveProperty('injectSource');
    expect(api).not.toHaveProperty('requireViewport');
  });

  it('exports the result types and the core type re-exports', () => {
    expectTypeOf<types.InjectHistoryResult>().toEqualTypeOf<InjectHistoryResult>();
    expectTypeOf<types.InjectLayersResult>().toEqualTypeOf<InjectLayersResult>();
    expectTypeOf<types.InjectSelectionOpsResult>().toEqualTypeOf<InjectSelectionOpsResult>();
    expectTypeOf<types.CameraState>().toEqualTypeOf<core.CameraState>();
    expectTypeOf<types.ElementStyle>().toEqualTypeOf<core.ElementStyle>();
    expectTypeOf<types.SelectionStyleDetails>().toEqualTypeOf<core.SelectionStyleDetails>();
    expectTypeOf<types.ElementRect>().toEqualTypeOf<core.ElementRect>();
    expectTypeOf<types.AlignEdge>().toEqualTypeOf<core.AlignEdge>();
    expectTypeOf<types.DistributeAxis>().toEqualTypeOf<core.DistributeAxis>();
  });
});
