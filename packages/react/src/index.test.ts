import { describe, it, expect } from 'vitest';
import { VERSION } from './index';

describe('react', () => {
  it('exports version', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
