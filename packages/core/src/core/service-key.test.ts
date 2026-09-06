import { describe, it, expect } from 'vitest';
import { createServiceKey } from './service-key';

interface GridService {
  snap(x: number): number;
}

interface HexService {
  cellCenter(q: number, r: number): { x: number; y: number };
}

describe('ServiceKey', () => {
  it('creates a key with the given name', () => {
    const key = createServiceKey<GridService>('grid');
    expect(key.name).toBe('grid');
  });

  it('each key has a unique symbol id', () => {
    const a = createServiceKey<GridService>('grid');
    const b = createServiceKey<GridService>('grid');
    expect(a.id).not.toBe(b.id);
  });

  it('keys with the same name are not equal', () => {
    const a = createServiceKey<GridService>('grid');
    const b = createServiceKey<GridService>('grid');
    expect(a).not.toBe(b);
    expect(a.id).not.toBe(b.id);
  });

  it('supports different generic types', () => {
    const gridKey = createServiceKey<GridService>('grid');
    const hexKey = createServiceKey<HexService>('hex');
    expect(gridKey.name).toBe('grid');
    expect(hexKey.name).toBe('hex');
    expect(gridKey.id).not.toBe(hexKey.id);
  });

  it('identity is by symbol reference, not name', () => {
    const key = createServiceKey<GridService>('grid');
    const map = new Map<symbol, string>();
    map.set(key.id, 'found');
    expect(map.get(key.id)).toBe('found');
  });
});
