import { describe, it, expect } from 'vitest';
import { fogLegacyMigrator } from './fog-legacy-migrator';
import type { LegacyCanvasState } from '@fieldnotes/core';

function makeLegacy(overrides: Record<string, unknown> = {}): LegacyCanvasState {
  return {
    version: 3,
    camera: { position: { x: 0, y: 0 }, zoom: 1 },
    elements: [],
    ...overrides,
  } as LegacyCanvasState;
}

describe('fogLegacyMigrator', () => {
  it('does nothing when no fog field is present', () => {
    const legacy = makeLegacy();
    fogLegacyMigrator(legacy);
    expect(legacy.extensions).toBeUndefined();
    expect('fog' in legacy).toBe(false);
  });

  it('migrates a structurally valid fog payload into extensions', () => {
    const fog = {
      definition: {
        version: 1,
        generation: 'g',
        bounds: { x: 0, y: 0, w: 100, h: 100 },
        cellSize: 50,
        tileCells: 128,
        base: 'covered',
      },
      tiles: [],
    };
    const legacy = makeLegacy({ fog });
    fogLegacyMigrator(legacy);

    expect(legacy.extensions?.['fog']).toEqual({ version: 1, data: fog });
    expect('fog' in legacy).toBe(false);
  });

  it('discards a malformed fog payload (non-object)', () => {
    const legacy = makeLegacy({ fog: 'invalid' });
    fogLegacyMigrator(legacy);
    expect(legacy.extensions?.['fog']).toBeUndefined();
    expect('fog' in legacy).toBe(false);
  });

  it('discards a fog payload missing required definition fields', () => {
    const legacy = makeLegacy({ fog: { source: 'legacy' } });
    fogLegacyMigrator(legacy);
    expect(legacy.extensions?.['fog']).toBeUndefined();
    expect('fog' in legacy).toBe(false);
  });

  it('discards a fog payload with non-numeric cellSize', () => {
    const legacy = makeLegacy({
      fog: {
        definition: { version: 1, bounds: {}, cellSize: 'big' },
        tiles: [],
      },
    });
    fogLegacyMigrator(legacy);
    expect(legacy.extensions?.['fog']).toBeUndefined();
    expect('fog' in legacy).toBe(false);
  });

  it('discards a fog payload where tiles is not an array', () => {
    const legacy = makeLegacy({
      fog: {
        definition: {
          version: 1,
          bounds: { x: 0, y: 0, w: 100, h: 100 },
          cellSize: 50,
        },
        tiles: 'none',
      },
    });
    fogLegacyMigrator(legacy);
    expect(legacy.extensions?.['fog']).toBeUndefined();
    expect('fog' in legacy).toBe(false);
  });

  it('preserves existing extensions.fog when both exist', () => {
    const legacy = makeLegacy({
      fog: { source: 'legacy' },
      extensions: { fog: { version: 1, data: { source: 'plugin' } } },
    });
    fogLegacyMigrator(legacy);
    expect(legacy.extensions?.['fog']?.data).toEqual({ source: 'plugin' });
    expect('fog' in legacy).toBe(false);
  });

  it('always deletes the top-level fog field', () => {
    const legacy = makeLegacy({ fog: null });
    fogLegacyMigrator(legacy);
    expect('fog' in legacy).toBe(false);
  });
});
