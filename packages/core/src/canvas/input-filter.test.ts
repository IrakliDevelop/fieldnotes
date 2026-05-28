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
});
