import { describe, it, expect } from 'vitest';
import type { ExtensionElementEnvelope } from '@fieldnotes/core';
import { gridElementTypeDefinition } from './grid-definition';

const envelope: ExtensionElementEnvelope = {
  id: 'grid-1',
  type: 'extension',
  extensionType: 'vtt:grid',
  position: { x: 0, y: 0 },
  index: 'a5',
  version: 7,
  editor: 'peer-2',
  locked: true,
  layerId: 'default',
  data: {
    gridType: 'hex',
    hexOrientation: 'flat',
    cellSize: 40,
    strokeColor: '#ccc',
    strokeWidth: 1,
    opacity: 0.5,
  },
};

describe('gridElementTypeDefinition', () => {
  it('wrap(unwrap(envelope)) preserves index, version and editor', () => {
    const rewrapped = gridElementTypeDefinition.wrap(gridElementTypeDefinition.unwrap(envelope));

    expect(rewrapped).toEqual(envelope);
  });
});
