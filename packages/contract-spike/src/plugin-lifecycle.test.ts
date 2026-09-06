/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-empty-function */
import { describe, it, expect } from 'vitest';
import { PluginStateManager } from './plugin-lifecycle';
import type { PluginHandle, PersistedPluginState } from './types';

function makeHandle(overrides: Partial<PluginHandle> = {}): PluginHandle {
  return {
    dispose: () => {},
    ...overrides,
  };
}

describe('PluginStateManager', () => {
  it('loads state with matching version', () => {
    const mgr = new PluginStateManager();
    const loaded: unknown[] = [];
    mgr.registerPlugin(
      'fog',
      makeHandle({
        stateVersion: 1,
        loadState: (data) => loaded.push(data),
        validateState: () => {},
      }),
    );

    const persisted: Record<string, PersistedPluginState> = {
      fog: { version: 1, data: { tiles: [] } },
    };

    const result = mgr.loadState(persisted);
    expect(result.success).toBe(true);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual({ tiles: [] });
  });

  it('migrates state before validation', () => {
    const mgr = new PluginStateManager();
    const migrated: unknown[] = [];
    mgr.registerPlugin(
      'fog',
      makeHandle({
        stateVersion: 2,
        migrateState: (data, fromVersion) => {
          migrated.push({ data, fromVersion });
          return { ...(data as Record<string, unknown>), migrated: true };
        },
        validateState: (data) => {
          if (!(data as Record<string, unknown>)['migrated']) {
            throw new Error('not migrated');
          }
        },
        loadState: () => {},
      }),
    );

    const persisted: Record<string, PersistedPluginState> = {
      fog: { version: 1, data: { tiles: [] } },
    };

    const result = mgr.loadState(persisted);
    expect(result.success).toBe(true);
    expect(migrated).toHaveLength(1);
    expect((migrated[0] as Record<string, unknown>)['fromVersion']).toBe(1);
  });

  it('drops plugin with missing migration, continues with others', () => {
    const mgr = new PluginStateManager();
    const gridLoaded: unknown[] = [];
    mgr.registerPlugin(
      'fog',
      makeHandle({
        stateVersion: 2,
        // no migrateState
      }),
    );
    mgr.registerPlugin(
      'grid',
      makeHandle({
        stateVersion: 1,
        loadState: (data) => gridLoaded.push(data),
      }),
    );

    const persisted: Record<string, PersistedPluginState> = {
      fog: { version: 1, data: {} },
      grid: { version: 1, data: { cells: [] } },
    };

    const result = mgr.loadState(persisted);
    expect(result.success).toBe(true);
    expect(result.droppedPlugins).toEqual(['fog']);
    expect(gridLoaded).toHaveLength(1);
    expect(gridLoaded[0]).toEqual({ cells: [] });
  });

  it('drops plugin when validation fails after migration', () => {
    const mgr = new PluginStateManager();
    mgr.registerPlugin(
      'fog',
      makeHandle({
        stateVersion: 2,
        migrateState: (data) => data,
        validateState: () => {
          throw new Error('invalid');
        },
      }),
    );

    const persisted: Record<string, PersistedPluginState> = {
      fog: { version: 1, data: {} },
    };

    const result = mgr.loadState(persisted);
    expect(result.success).toBe(true);
    expect(result.droppedPlugins).toEqual(['fog']);
  });

  it('preserves unknown plugin entries with original version', () => {
    const mgr = new PluginStateManager();

    const persisted: Record<string, PersistedPluginState> = {
      unknown_plugin: { version: 3, data: { custom: true } },
    };

    const result = mgr.loadState(persisted);
    expect(result.success).toBe(true);

    const exported = mgr.exportState();
    expect(exported['unknown_plugin']).toBeDefined();
    expect(exported['unknown_plugin']!.version).toBe(3);
    expect(exported['unknown_plugin']!.data).toEqual({ custom: true });
  });

  it('catches throwing loadState, continues with other plugins', () => {
    const mgr = new PluginStateManager();
    const gridLoaded: unknown[] = [];
    mgr.registerPlugin(
      'fog',
      makeHandle({
        stateVersion: 1,
        loadState: () => {
          throw new Error('load failed');
        },
      }),
    );
    mgr.registerPlugin(
      'grid',
      makeHandle({
        stateVersion: 1,
        loadState: (data) => gridLoaded.push(data),
      }),
    );

    const persisted: Record<string, PersistedPluginState> = {
      fog: { version: 1, data: {} },
      grid: { version: 1, data: { cells: [] } },
    };

    const result = mgr.loadState(persisted);
    expect(result.success).toBe(true);
    expect(result.droppedPlugins).toContain('fog');
    expect(gridLoaded).toHaveLength(1);
    expect(gridLoaded[0]).toEqual({ cells: [] });
  });

  it('exportState reflects loaded state, not stale exportState()', () => {
    const mgr = new PluginStateManager();
    let internalData: unknown = { tiles: [] };
    mgr.registerPlugin(
      'fog',
      makeHandle({
        stateVersion: 1,
        loadState: (data) => {
          // Simulate loadState enriching the data
          internalData = { ...(data as Record<string, unknown>), loaded: true };
        },
        exportState: () => internalData,
      }),
    );

    const persisted: Record<string, PersistedPluginState> = {
      fog: { version: 1, data: { tiles: [] } },
    };

    mgr.loadState(persisted);
    const exported = mgr.exportState();
    expect(exported['fog']!.data).toEqual({ tiles: [], loaded: true });
  });

  it('exports state with versioned envelope', () => {
    const mgr = new PluginStateManager();
    mgr.registerPlugin(
      'fog',
      makeHandle({
        stateVersion: 2,
        exportState: () => ({ tiles: [1, 2, 3] }),
      }),
    );

    const exported = mgr.exportState();
    expect(exported['fog']).toBeDefined();
    expect(exported['fog']!.version).toBe(2);
    expect(exported['fog']!.data).toEqual({ tiles: [1, 2, 3] });
  });
});
