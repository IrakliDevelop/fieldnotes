import { describe, expect, it } from 'vitest';
import { version } from 'react';
import { version as domVersion } from 'react-dom';

describe('React 18 check', () => {
  it('runs against React 18', () => {
    expect(version).toMatch(/^18\./);
    expect(domVersion).toMatch(/^18\./);
  });
});
