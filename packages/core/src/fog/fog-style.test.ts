import { describe, expect, it } from 'vitest';
import type { FogProceduralStyle, FogSolidStyle } from './fog-style';
import { fogStyleCacheKey, resolveFogStyle } from './fog-style';

describe('resolveFogStyle', () => {
  const DEFAULT = '#111111';

  it('returns solid with default color when no style or legacy color given', () => {
    const result = resolveFogStyle(undefined, undefined, DEFAULT);
    expect(result).toEqual({ kind: 'solid', color: DEFAULT });
  });

  it('uses legacy color when no style given', () => {
    const result = resolveFogStyle(undefined, '#ff0000', DEFAULT);
    expect(result).toEqual({ kind: 'solid', color: '#ff0000' });
  });

  it('explicit style takes precedence over legacy color', () => {
    const style: FogSolidStyle = { kind: 'solid', color: '#00ff00' };
    const result = resolveFogStyle(style, '#ff0000', DEFAULT);
    expect(result).toEqual({ kind: 'solid', color: '#00ff00' });
  });

  it('solid style without explicit kind resolves as solid', () => {
    const style: FogSolidStyle = { color: '#aabbcc' };
    const result = resolveFogStyle(style, undefined, DEFAULT);
    expect(result).toEqual({ kind: 'solid', color: '#aabbcc' });
  });

  it('resolves procedural with defaults', () => {
    const style: FogProceduralStyle = { kind: 'procedural', backdrop: '#1a1a2e' };
    const result = resolveFogStyle(style, undefined, DEFAULT);
    expect(result).toEqual({
      kind: 'procedural',
      backdrop: '#1a1a2e',
      tint: '#1a1a2e',
      opacity: 0.6,
      scale: 256,
      seed: 0,
      detail: 2,
    });
  });

  it('resolves procedural with explicit values', () => {
    const style: FogProceduralStyle = {
      kind: 'procedural',
      backdrop: '#0b1020',
      tint: '#2a3050',
      opacity: 0.8,
      scale: 512,
      seed: 42,
      detail: 3,
    };
    const result = resolveFogStyle(style, undefined, DEFAULT);
    expect(result).toEqual({
      kind: 'procedural',
      backdrop: '#0b1020',
      tint: '#2a3050',
      opacity: 0.8,
      scale: 512,
      seed: 42,
      detail: 3,
    });
  });

  it('clamps opacity to [0, 1]', () => {
    const over = resolveFogStyle(
      { kind: 'procedural', backdrop: '#000', opacity: 5 },
      undefined,
      DEFAULT,
    );
    expect(over.kind === 'procedural' && over.opacity).toBe(1);

    const under = resolveFogStyle(
      { kind: 'procedural', backdrop: '#000', opacity: -1 },
      undefined,
      DEFAULT,
    );
    expect(under.kind === 'procedural' && under.opacity).toBe(0);
  });

  it('clamps scale to [64, 1024]', () => {
    const small = resolveFogStyle(
      { kind: 'procedural', backdrop: '#000', scale: 10 },
      undefined,
      DEFAULT,
    );
    expect(small.kind === 'procedural' && small.scale).toBe(64);

    const large = resolveFogStyle(
      { kind: 'procedural', backdrop: '#000', scale: 9999 },
      undefined,
      DEFAULT,
    );
    expect(large.kind === 'procedural' && large.scale).toBe(1024);
  });

  it('clamps seed to [0, 65535] and floors', () => {
    const result = resolveFogStyle(
      { kind: 'procedural', backdrop: '#000', seed: 100000.7 },
      undefined,
      DEFAULT,
    );
    expect(result.kind === 'procedural' && result.seed).toBe(65535);

    const neg = resolveFogStyle(
      { kind: 'procedural', backdrop: '#000', seed: -5 },
      undefined,
      DEFAULT,
    );
    expect(neg.kind === 'procedural' && neg.seed).toBe(0);
  });

  it('clamps detail to [1, 4] and floors', () => {
    const result = resolveFogStyle(
      { kind: 'procedural', backdrop: '#000', detail: 7.5 },
      undefined,
      DEFAULT,
    );
    expect(result.kind === 'procedural' && result.detail).toBe(4);
  });

  it('does not mutate input', () => {
    const style: FogProceduralStyle = { kind: 'procedural', backdrop: '#000' };
    const frozen = Object.freeze(style);
    expect(() => resolveFogStyle(frozen, undefined, DEFAULT)).not.toThrow();
  });
});

describe('fogStyleCacheKey', () => {
  it('produces different keys for solid vs procedural', () => {
    const solid = fogStyleCacheKey({ kind: 'solid', color: '#000' });
    const proc = fogStyleCacheKey({
      kind: 'procedural',
      backdrop: '#000',
      tint: '#000',
      opacity: 0.6,
      scale: 256,
      seed: 0,
      detail: 2,
    });
    expect(solid).not.toBe(proc);
  });

  it('produces different keys for different seeds', () => {
    const a = fogStyleCacheKey({
      kind: 'procedural',
      backdrop: '#000',
      tint: '#000',
      opacity: 0.6,
      scale: 256,
      seed: 0,
      detail: 2,
    });
    const b = fogStyleCacheKey({
      kind: 'procedural',
      backdrop: '#000',
      tint: '#000',
      opacity: 0.6,
      scale: 256,
      seed: 1,
      detail: 2,
    });
    expect(a).not.toBe(b);
  });
});
