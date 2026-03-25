import { describe, it, expect } from 'vitest';
import { VERSION } from './index';

describe('core', () => {
  it('exports version', () => {
    expect(VERSION).toBe('0.8.5');
  });
});
