// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Viewport } from '@fieldnotes/core';
import { fogLegacyMigrator } from './fog-legacy-migrator';
import type { LegacyCanvasState } from '@fieldnotes/core';
import { FogManager } from './fog-manager';
import { createFogPlugin } from './fog-plugin';
import { registerVttElementTypes } from '../register';

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
      fog: {
        definition: {
          version: 1,
          generation: 'legacy-generation',
          bounds: { x: 0, y: 0, w: 128, h: 128 },
          cellSize: 1,
          tileCells: 128,
          base: 'covered',
        },
        tiles: [],
      },
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

describe('registered legacy fog migration', () => {
  const viewports: Viewport[] = [];
  const containers: HTMLDivElement[] = [];

  afterEach(() => {
    for (const viewport of viewports.splice(0)) viewport.destroy();
    for (const container of containers.splice(0)) container.remove();
  });

  beforeAll(() => {
    registerVttElementTypes();
  });

  function loadLegacyFog(fog: unknown): FogManager {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    });
    document.body.appendChild(container);
    containers.push(container);
    const manager = new FogManager();
    const viewport = new Viewport(container, { plugins: [createFogPlugin({ manager })] });
    viewports.push(viewport);
    viewport.loadJSON(
      JSON.stringify({
        version: 3,
        camera: { position: { x: 0, y: 0 }, zoom: 1 },
        elements: [],
        fog,
      }),
    );
    return manager;
  }

  it('migrates canonical v3 fog through registered parsing and plugin loading', () => {
    const fog = {
      definition: {
        version: 1,
        generation: 'legacy-generation',
        bounds: { x: 0, y: 0, w: 128, h: 128 },
        cellSize: 1,
        tileCells: 128,
        base: 'covered',
      },
      tiles: [],
    };

    expect(loadLegacyFog(fog).getState()).toEqual(fog);
  });

  it('discards primitive legacy fog without aborting canvas load', () => {
    const manager = loadLegacyFog('invalid');

    expect(manager.getState()).toBeNull();
  });

  it('discards deeply malformed legacy fog without aborting canvas load', () => {
    const malformedFog = {
      definition: {
        version: 1,
        generation: 'legacy-generation',
        bounds: { x: 0, y: 0, w: 128, h: 128 },
        cellSize: 1,
        tileCells: 128,
        base: 'covered',
      },
      tiles: [{ x: 0, y: 0, data: 'not-base64' }],
    };

    const manager = loadLegacyFog(malformedFog);

    expect(manager.getState()).toBeNull();
  });
});
