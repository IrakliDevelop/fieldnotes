import { describe, expect, it } from 'vitest';
import { pickBaseFields } from './base-fields';
import type { BaseElement } from './types';

describe('pickBaseFields', () => {
  it('copies every base field and drops the rest', () => {
    const element = {
      id: 'm1',
      type: 'marker',
      position: { x: 1, y: 2 },
      index: 'a1',
      version: 3,
      editor: 'peer',
      locked: true,
      layerId: 'L1',
      groupId: 'g1',
      rotation: 0.5,
      label: 'not base',
    };
    expect(pickBaseFields(element)).toEqual({
      id: 'm1',
      type: 'marker',
      position: { x: 1, y: 2 },
      index: 'a1',
      version: 3,
      editor: 'peer',
      locked: true,
      layerId: 'L1',
      groupId: 'g1',
      rotation: 0.5,
    });
  });

  it('omits optional base fields that are absent', () => {
    const element: BaseElement = {
      id: 'n1',
      type: 'note',
      position: { x: 0, y: 0 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId: '',
    };
    expect(Object.keys(pickBaseFields(element)).sort()).toEqual(
      ['id', 'index', 'layerId', 'locked', 'position', 'type', 'version'].sort(),
    );
  });
});
