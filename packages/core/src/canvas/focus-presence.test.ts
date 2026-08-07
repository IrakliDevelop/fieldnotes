import { describe, it, expect } from 'vitest';
import {
  FOCUS_PRESENCE_KIND,
  isFocusPresence,
  toFocusPresence,
  type FocusPresence,
} from './focus-presence';

const VALID: FocusPresence = {
  kind: 'focus',
  x: 0,
  y: 0,
  w: 100,
  h: 80,
  audience: 'players',
};

describe('isFocusPresence', () => {
  it('accepts a valid payload with and without color', () => {
    expect(isFocusPresence(VALID)).toBe(true);
    expect(isFocusPresence({ ...VALID, color: '#F4C430' })).toBe(true);
  });

  it('rejects other presence kinds so their handlers stay undisturbed', () => {
    expect(isFocusPresence({ kind: 'poke', feature: 'initiative' })).toBe(false);
    expect(isFocusPresence({ kind: 'laser', points: [] })).toBe(false);
    expect(isFocusPresence({ kind: 'ping', x: 1, y: 2 })).toBe(false);
    expect(isFocusPresence({ kind: 'measure', start: {}, end: {} })).toBe(false);
  });

  it('rejects the kind check alone, holding every other field valid', () => {
    // Each fixture is otherwise a fully valid focus payload, so only the
    // `kind` check can be responsible for the rejection.
    expect(isFocusPresence({ ...VALID, kind: 'poke' })).toBe(false);
    expect(isFocusPresence({ ...VALID, kind: 'laser' })).toBe(false);
    expect(isFocusPresence({ ...VALID, kind: 'ping' })).toBe(false);
    expect(isFocusPresence({ ...VALID, kind: 'measure' })).toBe(false);
    const { x, y, w, h, audience, color } = VALID;
    expect(isFocusPresence({ x, y, w, h, audience, color })).toBe(false);
    expect(isFocusPresence({ ...VALID, kind: 1 })).toBe(false);
  });

  it('rejects non-objects and null', () => {
    expect(isFocusPresence(null)).toBe(false);
    expect(isFocusPresence(undefined)).toBe(false);
    expect(isFocusPresence('focus')).toBe(false);
    expect(isFocusPresence(42)).toBe(false);
  });

  it('rejects unknown or malformed audiences without defaulting', () => {
    expect(isFocusPresence({ ...VALID, audience: 'everyone' })).toBe(false);
    expect(isFocusPresence({ ...VALID, audience: undefined })).toBe(false);
    expect(isFocusPresence({ ...VALID, audience: 1 })).toBe(false);
  });

  it('rejects non-finite and non-positive dimensions', () => {
    expect(isFocusPresence({ ...VALID, x: NaN })).toBe(false);
    expect(isFocusPresence({ ...VALID, y: Infinity })).toBe(false);
    expect(isFocusPresence({ ...VALID, w: 0 })).toBe(false);
    expect(isFocusPresence({ ...VALID, h: -5 })).toBe(false);
    expect(isFocusPresence({ ...VALID, w: '100' })).toBe(false);
  });

  it('rejects a DEFINED non-string color', () => {
    expect(isFocusPresence({ ...VALID, color: 1 })).toBe(false);
    expect(isFocusPresence({ ...VALID, color: {} })).toBe(false);
    expect(isFocusPresence({ ...VALID, color: null })).toBe(false);
  });
});

describe('toFocusPresence', () => {
  it('builds a payload from a view and audience', () => {
    expect(toFocusPresence({ x: 1, y: 2, w: 3, h: 4 }, 'display', '#fff')).toEqual({
      kind: FOCUS_PRESENCE_KIND,
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      audience: 'display',
      color: '#fff',
    });
  });

  it('omits color when not supplied and round-trips through the guard', () => {
    const payload = toFocusPresence({ x: 1, y: 2, w: 3, h: 4 }, 'all');
    expect(payload.color).toBeUndefined();
    expect(isFocusPresence(payload)).toBe(true);
  });
});
