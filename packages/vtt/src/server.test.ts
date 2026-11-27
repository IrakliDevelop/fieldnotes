import { createNote } from '@fieldnotes/core';
import type { SyncOp } from '@fieldnotes/sync';
import { MemoryHubBackend } from '@fieldnotes/sync-server';
import type { ServerOpContext, ServerSyncPlugin } from '@fieldnotes/sync-server';
import { describe, expect, it, vi } from 'vitest';
import { createFogServerPlugin } from './server';
import type { FogOp, FogServerPluginOptions } from './server';

const MISSING_WRITER =
  'createFogServerPlugin: pass `authorize`, or `allowAnyWriter: true` to let every member change the fog';
const COMBINED = 'createFogServerPlugin: `allowAnyWriter` cannot be combined with `authorize`';
const SNAPSHOT_WITHOUT_OP =
  'createFogServerPlugin: `filterSnapshot` requires `filterOp` (live fog ops would bypass it)';
const OP_WITHOUT_SNAPSHOT =
  'createFogServerPlugin: `filterOp` requires `filterSnapshot` (the join snapshot would bypass it)';

const meta: FogOp = { kind: 'fog-meta', record: { version: 2, editor: 'alice' } };
const viewer = { userId: 'bob', role: 'player', room: 'R' };

function context(): ServerOpContext {
  return {
    room: 'R',
    connectionId: 'c1',
    userId: 'alice',
    backend: new MemoryHubBackend(),
    backendPlugin: () => undefined,
  };
}

function process(plugin: ServerSyncPlugin, op: SyncOp) {
  if (!plugin.process) throw new Error('fog plugin has no process');
  return plugin.process(op, context(), () => Promise.reject(new Error('next called')));
}

describe('createFogServerPlugin', () => {
  it.each<[string, FogServerPluginOptions | undefined, string]>([
    ['no options', undefined, MISSING_WRITER],
    ['empty options', {}, MISSING_WRITER],
    ['allowAnyWriter false without authorize', { allowAnyWriter: false }, MISSING_WRITER],
    [
      'allowAnyWriter combined with authorize',
      { allowAnyWriter: true, authorize: () => true },
      COMBINED,
    ],
    [
      'filterSnapshot without filterOp',
      { allowAnyWriter: true, filterSnapshot: (snapshot) => snapshot },
      SNAPSHOT_WITHOUT_OP,
    ],
    [
      'filterOp without filterSnapshot',
      { allowAnyWriter: true, filterOp: (op) => op },
      OP_WITHOUT_SNAPSHOT,
    ],
  ])('throws for %s', (_, options, message) => {
    expect(() => createFogServerPlugin(options)).toThrow(message);
  });

  it('accepts authorize with allowAnyWriter false', () => {
    expect(() =>
      createFogServerPlugin({ authorize: () => true, allowAnyWriter: false }),
    ).not.toThrow();
  });

  it('accepts a fog-meta write with allowAnyWriter', async () => {
    const result = await process(createFogServerPlugin({ allowAnyWriter: true }), meta);

    expect(result.accepted).toEqual(meta);
  });

  it.each([
    [
      'throws',
      () => {
        throw new Error('boom');
      },
    ],
    ['rejects', () => Promise.reject(new Error('boom'))],
  ])('denies a write when authorize %s', async (_, authorize) => {
    const denied = await process(createFogServerPlugin({ authorize: () => false }), meta);

    const result = await process(createFogServerPlugin({ authorize }), meta);

    expect(result.accepted).toBeNull();
    expect(result.corrections).toEqual([
      { kind: 'fog-meta', record: { version: 1, editor: 'hub' } },
    ]);
    expect(result).toEqual(denied);
  });

  it('denies a write when authorize returns a non-boolean truthy value', async () => {
    const denied = await process(createFogServerPlugin({ authorize: () => false }), meta);
    const authorize = (() => 'no') as unknown as FogServerPluginOptions['authorize'];

    const result = await process(createFogServerPlugin({ authorize }), meta);

    expect(result.accepted).toBeNull();
    expect(result).toEqual(denied);
  });

  it('filterOp passes fog ops to the host hook and ignores other kinds', () => {
    const redacted: FogOp = { kind: 'fog-patch', generation: 'g1', tiles: [] };
    const hook = vi.fn(() => redacted);
    const plugin = createFogServerPlugin({
      allowAnyWriter: true,
      filterSnapshot: (snapshot) => snapshot,
      filterOp: hook,
    });
    const patch: FogOp = {
      kind: 'fog-patch',
      generation: 'g1',
      tiles: [{ generation: 'g1', x: 0, y: 0, version: 1, editor: 'alice' }],
    };
    const upsert: SyncOp = { kind: 'upsert', element: createNote({ position: { x: 0, y: 0 } }) };

    expect(plugin.filterOp?.(patch, viewer)).toBe(redacted);
    expect(hook).toHaveBeenCalledWith(patch, viewer);
    hook.mockClear();
    expect(plugin.filterOp?.(upsert, viewer)).toBe(upsert);
    expect(hook).not.toHaveBeenCalled();
  });

  it('exposes no filterOp when the host sets none', () => {
    expect(createFogServerPlugin({ allowAnyWriter: true }).filterOp).toBeUndefined();
  });
});
