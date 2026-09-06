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

  it('fails when migration is missing for version mismatch', () => {
    const mgr = new PluginStateManager();
    mgr.registerPlugin(
      'fog',
      makeHandle({
        stateVersion: 2,
      }),
    );

    const persisted: Record<string, PersistedPluginState> = {
      fog: { version: 1, data: {} },
    };

    const result = mgr.loadState(persisted);
    expect(result.success).toBe(false);
    expect(result.error).toContain('no migrateState');
  });

  it('fails when validation fails after migration', () => {
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
    expect(result.success).toBe(false);
    expect(result.error).toContain('validation failed');
  });

  it('preserves unknown plugin entries', () => {
    const mgr = new PluginStateManager();

    const persisted: Record<string, PersistedPluginState> = {
      unknownPlugin: { version: 3, data: { custom: true } },
    };

    const result = mgr.loadState(persisted);
    expect(result.success).toBe(true);
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
