/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InputFilter } from './input-filter';

function makePointerEvent(
  type: string,
  opts: Partial<PointerEventInit> & { pointerType?: string } = {},
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    pointerId: 1,
    clientX: 100,
    clientY: 100,
    ...opts,
  });
}

describe('InputFilter', () => {
  let filter: InputFilter;

  beforeEach(() => {
    filter = new InputFilter();
  });

  describe('mouse events', () => {
    it('dispatches mouse down', () => {
      const e = makePointerEvent('pointerdown', { pointerType: 'mouse' });
      expect(filter.filterDown(e).action).toBe('dispatch');
    });

    it('dispatches mouse move', () => {
      const e = makePointerEvent('pointermove', { pointerType: 'mouse' });
      expect(filter.filterMove(e).action).toBe('dispatch');
    });

    it('dispatches mouse up', () => {
      const e = makePointerEvent('pointerup', { pointerType: 'mouse' });
      expect(filter.filterUp(e).action).toBe('dispatch');
    });
  });

  describe('pen events', () => {
    it('dispatches pen down', () => {
      const e = makePointerEvent('pointerdown', { pointerType: 'pen', pointerId: 10 });
      expect(filter.filterDown(e).action).toBe('dispatch');
    });

    it('dispatches pen move', () => {
      const e = makePointerEvent('pointermove', { pointerType: 'pen', pointerId: 10 });
      expect(filter.filterMove(e).action).toBe('dispatch');
    });

    it('dispatches pen up and clears active pen', () => {
      const down = makePointerEvent('pointerdown', { pointerType: 'pen', pointerId: 10 });
      filter.filterDown(down);

      const up = makePointerEvent('pointerup', { pointerType: 'pen', pointerId: 10 });
      const result = filter.filterUp(up);
      expect(result.action).toBe('dispatch');

      const touchDown = makePointerEvent('pointerdown', { pointerType: 'touch', pointerId: 20 });
      expect(filter.filterDown(touchDown).action).not.toBe('suppress');
    });
  });

  describe('palm rejection', () => {
    it('suppresses touch down while pen is active', () => {
      filter.filterDown(makePointerEvent('pointerdown', { pointerType: 'pen', pointerId: 10 }));

      const touchDown = makePointerEvent('pointerdown', { pointerType: 'touch', pointerId: 20 });
      expect(filter.filterDown(touchDown).action).toBe('suppress');
    });

    it('suppresses touch move while pen is active', () => {
      filter.filterDown(makePointerEvent('pointerdown', { pointerType: 'pen', pointerId: 10 }));

      const touchMove = makePointerEvent('pointermove', { pointerType: 'touch', pointerId: 20 });
      expect(filter.filterMove(touchMove).action).toBe('suppress');
    });

    it('suppresses touch up while pen is active', () => {
      filter.filterDown(makePointerEvent('pointerdown', { pointerType: 'pen', pointerId: 10 }));

      const touchUp = makePointerEvent('pointerup', { pointerType: 'touch', pointerId: 20 });
      expect(filter.filterUp(touchUp).action).toBe('suppress');
    });

    it('does not suppress mouse events while pen is active', () => {
      filter.filterDown(makePointerEvent('pointerdown', { pointerType: 'pen', pointerId: 10 }));

      const mouseDown = makePointerEvent('pointerdown', { pointerType: 'mouse', pointerId: 30 });
      expect(filter.filterDown(mouseDown).action).toBe('dispatch');
    });

    it('resumes touch after pen lifts', () => {
      filter.filterDown(makePointerEvent('pointerdown', { pointerType: 'pen', pointerId: 10 }));
      filter.filterUp(makePointerEvent('pointerup', { pointerType: 'pen', pointerId: 10 }));

      const touchDown = makePointerEvent('pointerdown', { pointerType: 'touch', pointerId: 20 });
      expect(filter.filterDown(touchDown).action).not.toBe('suppress');
    });

    it('handles multiple sequential pen strokes', () => {
      filter.filterDown(makePointerEvent('pointerdown', { pointerType: 'pen', pointerId: 10 }));
      filter.filterUp(makePointerEvent('pointerup', { pointerType: 'pen', pointerId: 10 }));

      filter.filterDown(makePointerEvent('pointerdown', { pointerType: 'pen', pointerId: 11 }));
      expect(
        filter.filterDown(makePointerEvent('pointerdown', { pointerType: 'touch', pointerId: 20 }))
          .action,
      ).toBe('suppress');

      filter.filterUp(makePointerEvent('pointerup', { pointerType: 'pen', pointerId: 11 }));
      expect(
        filter.filterDown(makePointerEvent('pointerdown', { pointerType: 'touch', pointerId: 21 }))
          .action,
      ).not.toBe('suppress');
    });
  });

  describe('reset', () => {
    it('clears active pen state', () => {
      filter.filterDown(makePointerEvent('pointerdown', { pointerType: 'pen', pointerId: 10 }));
      filter.reset();

      const touchDown = makePointerEvent('pointerdown', { pointerType: 'touch', pointerId: 20 });
      expect(filter.filterDown(touchDown).action).not.toBe('suppress');
    });
  });

  describe('touch debounce', () => {
    it('defers touch down (no pen active)', () => {
      const e = makePointerEvent('pointerdown', { pointerType: 'touch', pointerId: 5 });
      expect(filter.filterDown(e).action).toBe('defer');
    });

    it('suppresses touch move under threshold', () => {
      filter.filterDown(
        makePointerEvent('pointerdown', {
          pointerType: 'touch',
          pointerId: 5,
          clientX: 100,
          clientY: 100,
        }),
      );

      const move = makePointerEvent('pointermove', {
        pointerType: 'touch',
        pointerId: 5,
        clientX: 101,
        clientY: 101,
      });
      expect(filter.filterMove(move).action).toBe('suppress');
    });

    it('dispatches touch move over threshold', () => {
      filter.filterDown(
        makePointerEvent('pointerdown', {
          pointerType: 'touch',
          pointerId: 5,
          clientX: 100,
          clientY: 100,
        }),
      );

      const move = makePointerEvent('pointermove', {
        pointerType: 'touch',
        pointerId: 5,
        clientX: 110,
        clientY: 110,
      });
      expect(filter.filterMove(move).action).toBe('dispatch');
    });

    it('returns pendingTap on touch up while deferred', () => {
      filter.filterDown(
        makePointerEvent('pointerdown', {
          pointerType: 'touch',
          pointerId: 5,
          clientX: 100,
          clientY: 200,
        }),
      );

      const up = makePointerEvent('pointerup', {
        pointerType: 'touch',
        pointerId: 5,
        clientX: 100,
        clientY: 200,
      });
      const result = filter.filterUp(up);
      expect(result.action).toBe('dispatch');
      expect(result.pendingTap).toEqual({ x: 100, y: 200 });
    });

    it('does not return pendingTap after threshold exceeded', () => {
      filter.filterDown(
        makePointerEvent('pointerdown', {
          pointerType: 'touch',
          pointerId: 5,
          clientX: 100,
          clientY: 100,
        }),
      );

      filter.filterMove(
        makePointerEvent('pointermove', {
          pointerType: 'touch',
          pointerId: 5,
          clientX: 120,
          clientY: 120,
        }),
      );

      const up = makePointerEvent('pointerup', {
        pointerType: 'touch',
        pointerId: 5,
      });
      const result = filter.filterUp(up);
      expect(result.action).toBe('dispatch');
      expect(result.pendingTap).toBeUndefined();
    });

    it('does not defer pen events', () => {
      const e = makePointerEvent('pointerdown', { pointerType: 'pen', pointerId: 10 });
      expect(filter.filterDown(e).action).toBe('dispatch');
    });

    it('does not defer mouse events', () => {
      const e = makePointerEvent('pointerdown', { pointerType: 'mouse' });
      expect(filter.filterDown(e).action).toBe('dispatch');
    });

    it('clears pending tap on reset', () => {
      filter.filterDown(
        makePointerEvent('pointerdown', {
          pointerType: 'touch',
          pointerId: 5,
          clientX: 100,
          clientY: 100,
        }),
      );
      filter.reset();

      const up = makePointerEvent('pointerup', { pointerType: 'touch', pointerId: 5 });
      const result = filter.filterUp(up);
      expect(result.pendingTap).toBeUndefined();
    });

    it('ignores move from different pointer than pending tap', () => {
      filter.filterDown(
        makePointerEvent('pointerdown', {
          pointerType: 'touch',
          pointerId: 5,
          clientX: 100,
          clientY: 100,
        }),
      );

      const move = makePointerEvent('pointermove', {
        pointerType: 'touch',
        pointerId: 99,
        clientX: 200,
        clientY: 200,
      });
      expect(filter.filterMove(move).action).toBe('dispatch');
    });
  });
});
