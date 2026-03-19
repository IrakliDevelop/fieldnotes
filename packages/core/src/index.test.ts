import { describe, it, expect } from 'vitest';
import { VERSION } from './index';

describe('core', () => {
  it('exports version', () => {
    expect(VERSION).toBe('0.1.2');
  });
});
