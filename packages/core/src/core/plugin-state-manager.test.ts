/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, vi } from 'vitest';
import { PluginStateManager } from './plugin-state-manager';
import type { PluginHandle, PersistedPluginState } from './plugin-state-manager';

function makeHandle(overrides: Partial<PluginHandle> = {}): PluginHandle {
  return {
    dispose: () => {},
    exportState: () => undefined,
    ...overrides,
  };
}

describe('PluginStateManager', () => {
  describe('registerPlugin and exportState', () => {
    it('exports state for registered plugins', () => {
      const mgr = new PluginStateManager();
      mgr.registerPlugin('fog', makeHandle({ exportState: () => ({ cells: [] }) }));

      const exported = mgr.exportState();
      expect(exported['fog']).toEqual({ version: 1, data: { cells: [] } });
    });

    it('uses stateVersion from handle', () => {
      const mgr = new PluginStateManager();
      mgr.registerPlugin('fog', makeHandle({ stateVersion: 3, exportState: () => 'data' }));

      expect(mgr.exportState()['fog']!.version).toBe(3);
    });

    it('defaults stateVersion to 1', () => {
      const mgr = new PluginStateManager();
      mgr.registerPlugin('fog', makeHandle({ exportState: () => 'data' }));

      expect(mgr.exportState()['fog']!.version).toBe(1);
    });
  });

  describe('loadState — unknown plugins', () => {
    it('preserves unknown plugin entries with original version', () => {
      const mgr = new PluginStateManager();
      const persisted: Record<string, PersistedPluginState> = {
        unknown_plugin: { version: 7, data: { custom: true } },
      };

      mgr.loadState(persisted);

      const exported = mgr.exportState();
      expect(exported['unknown_plugin']).toEqual({ version: 7, data: { custom: true } });
    });
  });

  describe('loadState — version migration', () => {
    it('migrates state when version differs', () => {
      const mgr = new PluginStateManager();
      const loaded: unknown[] = [];
      mgr.registerPlugin(
        'fog',
        makeHandle({
          stateVersion: 2,
          migrateState: (data) => ({ ...(data as object), migrated: true }),
          loadState: (data) => loaded.push(data),
        }),
      );

      mgr.loadState({ fog: { version: 1, data: { cells: [] } } });

      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toEqual({ cells: [], migrated: true });
    });

    it('skips migration when version matches', () => {
      const mgr = new PluginStateManager();
      const migrateFn = vi.fn();
      const loaded: unknown[] = [];
      mgr.registerPlugin(
        'fog',
        makeHandle({
          stateVersion: 1,
          migrateState: migrateFn,
          loadState: (data) => loaded.push(data),
        }),
      );

      mgr.loadState({ fog: { version: 1, data: { cells: [] } } });

      expect(migrateFn).not.toHaveBeenCalled();
      expect(loaded[0]).toEqual({ cells: [] });
    });

    it('drops plugin when migration is not provided', () => {
      const mgr = new PluginStateManager();
      mgr.registerPlugin(
        'fog',
        makeHandle({
          stateVersion: 2,
          loadState: () => {},
        }),
      );

      const result = mgr.loadState({ fog: { version: 1, data: {} } });

      expect(result.droppedPlugins).toEqual(['fog']);
    });

    it('drops plugin when migration throws', () => {
      const mgr = new PluginStateManager();
      mgr.registerPlugin(
        'fog',
        makeHandle({
          stateVersion: 2,
          migrateState: () => {
            throw new Error('migration failed');
          },
          loadState: () => {},
        }),
      );

      const result = mgr.loadState({ fog: { version: 1, data: {} } });

      expect(result.droppedPlugins).toEqual(['fog']);
    });
  });

  describe('loadState — validation', () => {
    it('aborts entire load when validation fails', () => {
      const resume = vi.fn();
      const discard = vi.fn();
      const mgr = new PluginStateManager(() => ({ resume, discard }));
      mgr.registerPlugin(
        'fog',
        makeHandle({
          stateVersion: 1,
          validateState: () => {
            throw new Error('invalid');
          },
          loadState: () => {},
        }),
      );

      const result = mgr.loadState({ fog: { version: 1, data: {} } });

      expect(result.success).toBe(false);
      expect(result.error).toContain('validation failed');
      expect(discard).toHaveBeenCalledOnce();
      expect(resume).not.toHaveBeenCalled();
    });
  });

  describe('loadState — transactional commit', () => {
    it('rolls back all plugins when one loadState throws', () => {
      const resume = vi.fn();
      const discard = vi.fn();
      const mgr = new PluginStateManager(() => ({ resume, discard }));
      let gridState: unknown = { before: 'grid' };
      let fogState: unknown = { before: 'fog' };

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

      const result = mgr.loadState({
        grid: { version: 1, data: { cells: [] } },
        fog: { version: 1, data: { fail: true } },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('load failed');
      expect(gridState).toEqual({ before: 'grid' });
      expect(fogState).toEqual({ before: 'fog' });
      expect(discard).toHaveBeenCalledOnce();
    });

    it('calls resume on successful load', () => {
      const resume = vi.fn();
      const discard = vi.fn();
      const mgr = new PluginStateManager(() => ({ resume, discard }));
      const loaded: unknown[] = [];
      mgr.registerPlugin(
        'fog',
        makeHandle({
          loadState: (data) => loaded.push(data),
        }),
      );

      const result = mgr.loadState({ fog: { version: 1, data: { cells: [] } } });

      expect(result.success).toBe(true);
      expect(resume).toHaveBeenCalledOnce();
      expect(discard).not.toHaveBeenCalled();
    });
  });

  describe('loadState — absent and dropped entries', () => {
    it('loads undefined for absent registered plugins', () => {
      const mgr = new PluginStateManager();
      const loaded: unknown[] = [];
      mgr.registerPlugin('fog', makeHandle({ loadState: (data) => loaded.push(data) }));

      mgr.loadState({});

      expect(loaded).toEqual([undefined]);
    });

    it('loads undefined for dropped plugins (missing migration)', () => {
      const mgr = new PluginStateManager();
      const loaded: unknown[] = [];
      mgr.registerPlugin(
        'fog',
        makeHandle({
          stateVersion: 2,
          loadState: (data) => loaded.push(data),
        }),
      );

      const result = mgr.loadState({ fog: { version: 1, data: { stale: true } } });

      expect(result.droppedPlugins).toEqual(['fog']);
      expect(loaded).toEqual([undefined]);
    });
  });

  describe('loadState — rollback safety', () => {
    it('rejects plugins with loadState but no exportState', () => {
      const mgr = new PluginStateManager();
      mgr.registerPlugin('fog', { dispose: () => {}, loadState: () => {} });

      const result = mgr.loadState({ fog: { version: 1, data: {} } });

      expect(result.success).toBe(false);
      expect(result.error).toContain('rollback is impossible');
    });
  });
});
