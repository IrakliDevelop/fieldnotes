import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useViewport } from './use-viewport';

describe('useViewport', () => {
  it('throws when used outside FieldNotesCanvas', () => {
    expect(() => {
      renderHook(() => useViewport());
    }).toThrow('useViewport must be used inside <FieldNotesCanvas>');
  });
});
