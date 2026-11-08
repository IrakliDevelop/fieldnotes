// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createViewportHarness } from '../test-helpers/viewport-harness';
import { drag, pointerDown, pointerMove, pointerUp } from '../test-helpers/pointer-helpers';
import type { ViewportHarness } from '../test-helpers/viewport-harness';
import type { ArrowTool } from '../tools/arrow-tool';

describe('Integration: elbow arrow history', () => {
  let harness: ViewportHarness;

  beforeEach(() => {
    harness = createViewportHarness();
    const tool = harness.viewport.toolManager.getTool<ArrowTool>('arrow');
    if (!tool) throw new Error('expected arrow tool');
    tool.setOptions({ routing: 'elbow' });
    harness.viewport.toolManager.setTool('arrow', harness.viewport.toolContext);
  });

  afterEach(() => harness.cleanup());

  it('creates one elbow arrow and one undo step with mouse', () => {
    drag(harness.wrapper, [100, 100], [300, 200]);

    expect(harness.viewport.store.getElementsByType('arrow')[0]?.routing).toBe('elbow');
    expect(harness.viewport.history.undoCount).toBe(1);
  });

  it('creates one elbow arrow and one undo step with touch', () => {
    pointerDown(harness.wrapper, 100, 100, { pointerType: 'touch' });
    pointerMove(harness.wrapper, 110, 100, { pointerType: 'touch' });
    pointerMove(harness.wrapper, 300, 200, { pointerType: 'touch' });
    pointerUp(harness.wrapper, 300, 200, { pointerType: 'touch' });

    expect(harness.viewport.store.getElementsByType('arrow')[0]?.routing).toBe('elbow');
    expect(harness.viewport.history.undoCount).toBe(1);
  });

  it('creates one elbow arrow and one undo step with pen', () => {
    pointerDown(harness.wrapper, 100, 100, { pointerType: 'pen' });
    pointerMove(harness.wrapper, 300, 200, { pointerType: 'pen' });
    pointerUp(harness.wrapper, 300, 200, { pointerType: 'pen' });

    expect(harness.viewport.store.getElementsByType('arrow')[0]?.routing).toBe('elbow');
    expect(harness.viewport.history.undoCount).toBe(1);
  });

  it('leaves no arrow or undo entry when cancelled or taken over by a pinch', () => {
    pointerDown(harness.wrapper, 100, 100);
    pointerMove(harness.wrapper, 300, 200);
    harness.wrapper.dispatchEvent(
      new PointerEvent('pointercancel', {
        bubbles: true,
        pointerId: 1,
        clientX: 300,
        clientY: 200,
      }),
    );

    expect(harness.viewport.store.getElementsByType('arrow')).toHaveLength(0);
    expect(harness.viewport.history.undoCount).toBe(0);

    pointerDown(harness.wrapper, 100, 100);
    pointerMove(harness.wrapper, 300, 200);
    pointerDown(harness.wrapper, 200, 100, { pointerId: 2, pointerType: 'touch' });
    pointerUp(harness.wrapper, 200, 100, { pointerId: 2, pointerType: 'touch' });
    pointerUp(harness.wrapper, 300, 200);

    expect(harness.viewport.store.getElementsByType('arrow')).toHaveLength(0);
    expect(harness.viewport.history.undoCount).toBe(0);
  });
});
