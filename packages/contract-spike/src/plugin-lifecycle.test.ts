/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-empty-function */
import { describe, it, expect, vi } from 'vitest';
import { PluginStateManager } from './plugin-lifecycle';
import type { PluginHandle, PersistedPluginState } from './types';

function makeHandle(overrides: Partial<PluginHandle> = {}): PluginHandle {
  return {
    dispose: () => {},
    exportState: () => undefined,
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
        loadState: () => {},
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

  it('aborts the entire load when validation fails after migration', () => {
    const resume = vi.fn();
    const discard = vi.fn();
    const mgr = new PluginStateManager(() => ({ resume, discard }));
    mgr.registerPlugin(
      'fog',
      makeHandle({
        stateVersion: 2,
        migrateState: (data) => data,
        validateState: () => {
          throw new Error('invalid');
        },
        loadState: () => {},
      }),
    );

    const persisted: Record<string, PersistedPluginState> = {
      fog: { version: 1, data: {} },
    };

    const result = mgr.loadState(persisted);
    expect(result.success).toBe(false);
    expect(result.error).toContain('validation failed');
    expect(discard).toHaveBeenCalledOnce();
    expect(resume).not.toHaveBeenCalled();
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

  it('rolls back all attempted plugins when a loadState commit throws', () => {
    const resume = vi.fn();
    const discard = vi.fn();
    const mgr = new PluginStateManager(() => ({ resume, discard }));
    let fogState: unknown = { before: 'fog' };
    let gridState: unknown = { before: 'grid' };
    mgr.registerPlugin(
      'grid',
      makeHandle({
        stateVersion: 1,
        exportState: () => gridState,
        loadState: (data) => {
          gridState = data;
        },
      }),
    );
    mgr.registerPlugin(
      'fog',
      makeHandle({
        stateVersion: 1,
        exportState: () => fogState,
        loadState: (data) => {
          fogState = data;
          if ((data as Record<string, unknown> | undefined)?.['fail']) {
            throw new Error('load failed');
          }
        },
      }),
    );

    const persisted: Record<string, PersistedPluginState> = {
      grid: { version: 1, data: { cells: [] } },
      fog: { version: 1, data: { fail: true } },
    };

    const result = mgr.loadState(persisted);
    expect(result.success).toBe(false);
    expect(result.error).toContain('load failed');
    expect(gridState).toEqual({ before: 'grid' });
    expect(fogState).toEqual({ before: 'fog' });
    expect(discard).toHaveBeenCalledOnce();
    expect(resume).not.toHaveBeenCalled();
  });

  it('loads undefined for absent or dropped entries so stale state is cleared', () => {
    const mgr = new PluginStateManager();
    const loaded: unknown[] = [];
    mgr.registerPlugin(
      'fog',
      makeHandle({
        stateVersion: 2,
        loadState: (data) => loaded.push(data),
      }),
    );
    mgr.registerPlugin(
      'grid',
      makeHandle({
        stateVersion: 1,
        loadState: (data) => loaded.push(data),
      }),
    );

    const result = mgr.loadState({ fog: { version: 1, data: { stale: true } } });

    expect(result).toEqual({ success: true, droppedPlugins: ['fog'] });
    expect(loaded).toEqual([undefined, undefined]);
  });

  it('rejects stateful plugins that cannot provide rollback state', () => {
    const mgr = new PluginStateManager();
    mgr.registerPlugin('fog', { dispose: () => {}, loadState: () => {} });

    const result = mgr.loadState({ fog: { version: 1, data: {} } });

    expect(result.success).toBe(false);
    expect(result.error).toContain('rollback is impossible');
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
