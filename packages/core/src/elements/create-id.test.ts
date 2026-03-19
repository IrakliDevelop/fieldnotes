import { describe, it, expect } from 'vitest';
import { createId } from './create-id';

describe('createId', () => {
  it('starts with the given prefix', () => {
    expect(createId('note').startsWith('note_')).toBe(true);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createId('el')));
    expect(ids.size).toBe(100);
  });
});
