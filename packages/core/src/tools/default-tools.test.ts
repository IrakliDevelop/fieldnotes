import { describe, it, expect } from 'vitest';
import { createDefaultTools } from './default-tools';

describe('createDefaultTools', () => {
  it('returns the default tools in toolbar order', () => {
    expect(createDefaultTools().map((tool) => tool.name)).toEqual([
      'hand',
      'select',
      'pencil',
      'eraser',
      'arrow',
      'note',
      'text',
      'shape',
      'frame',
    ]);
  });

  it('returns fresh instances on every call', () => {
    const first = createDefaultTools();
    const second = createDefaultTools();
    first.forEach((tool, i) => expect(second[i]).not.toBe(tool));
  });
});
