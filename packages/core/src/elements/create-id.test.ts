import { describe, it, expect, vi } from 'vitest';
import { createId, formatId, randomClientComponent } from './create-id';

describe('createId', () => {
  it('starts with the given prefix', () => {
    expect(createId('note').startsWith('note_')).toBe(true);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createId('el')));
    expect(ids.size).toBe(100);
  });

  it('includes a stable per-process client component', () => {
    const parts = createId('x').split('_');
    expect(parts.length).toBeGreaterThanOrEqual(4);
    expect(parts[parts.length - 1]).not.toBe('');
    expect(createId('a').split('_').pop()).toBe(createId('b').split('_').pop());
  });
});

describe('formatId', () => {
  it('differs when only the client component differs (collision fix)', () => {
    expect(formatId('el', 't', '0', 'a')).not.toBe(formatId('el', 't', '0', 'b'));
  });

  it('joins the components with underscores', () => {
    expect(formatId('el', 't', '0', 'c')).toBe('el_t_0_c');
  });
});

describe('randomClientComponent', () => {
  it('falls back without crypto.getRandomValues', () => {
    vi.stubGlobal('crypto', undefined);
    try {
      expect(randomClientComponent()).toMatch(/^[a-z0-9]+$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
