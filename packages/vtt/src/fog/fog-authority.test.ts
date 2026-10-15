import { describe, expect, it, vi } from 'vitest';
import type { AuthorityMutation } from '@fieldnotes/sync';
import { AuthorityClientDocument } from '../../../sync/src/authority-client-document';
import { FogLedger } from './fog-ledger';
import { FogSyncController } from './fog-sync-controller';
import type { FogMetaRecord, FogSnapshot, FogTileRecord } from './fog-sync-types';
import { createTileBytes, encodeBase64, setBit } from './tile-codec';
import {
  applyFogAuthorityIntent,
  createFogAuthorityClientExtension,
  prepareFogAuthorityIntent,
} from './fog-authority';
import { createFogAuthorityServerExtension } from '../server';

const definition = (generation = 'generation-1', bounds = { x: 0, y: 0, w: 128, h: 128 }) => ({
  version: 1 as const,
  generation,
  bounds,
  cellSize: 1,
  tileCells: 128 as const,
  base: 'covered' as const,
});

const meta = (
  version = 1,
  editor = 'dm',
  generation = 'generation-1',
  bounds = { x: 0, y: 0, w: 128, h: 128 },
): FogMetaRecord => ({ version, editor, definition: definition(generation, bounds) });

const data = (): string => {
  const bytes = createTileBytes(false);
  setBit(bytes, 0, 0, true);
  return encodeBase64(bytes);
};

const tile = (
  x = 0,
  y = 0,
  version = 1,
  editor = 'dm',
  generation = 'generation-1',
  includeData = true,
): FogTileRecord => ({
  generation,
  x,
  y,
  version,
  editor,
  ...(includeData ? { data: data() } : {}),
});

function apply(
  current: FogSnapshot | null,
  mutation: AuthorityMutation,
): ReturnType<typeof applyFogAuthorityIntent> {
  const intent = prepareFogAuthorityIntent(mutation);
  if (intent === null) throw new Error('fixture expected a fog intent');
  return applyFogAuthorityIntent(current, mutation, intent);
}

function applyRaw(
  current: FogSnapshot | null,
  mutation: AuthorityMutation,
): ReturnType<typeof applyFogAuthorityIntent> {
  const intent =
    mutation.kind === 'fog-meta'
      ? { schema: 1 as const, kind: 'meta' as const, record: mutation.record }
      : mutation.kind === 'fog-patch'
        ? {
            schema: 1 as const,
            kind: 'patch' as const,
            generation: mutation.generation,
            tiles: mutation.tiles,
          }
        : { schema: 1 as const, kind: 'meta' as const, record: meta() };
  return applyFogAuthorityIntent(current, mutation, intent);
}

function acceptedState(result: ReturnType<typeof applyFogAuthorityIntent>): FogSnapshot | null {
  if (result.status !== 'accepted') throw new Error(`fixture rejected: ${result.reason}`);
  return result.state;
}

function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

describe('fog authority intent boundary', () => {
  it('prepares exact bounded frozen copies and ignores non-fog mutations', () => {
    expect(prepareFogAuthorityIntent({ kind: 'remove', id: 'x' })).toBeNull();
    const record = meta();
    const mutation = { kind: 'fog-meta' as const, record };
    const intent = prepareFogAuthorityIntent(mutation);

    expect(intent).toEqual({ schema: 1, kind: 'meta', record });
    expect(intent).not.toBe(mutation);
    expect(intent && intent.kind === 'meta' ? intent.record : null).not.toBe(record);
    expectDeepFrozen(intent);
    expect(Object.isFrozen(record)).toBe(false);
  });

  it('rejects hostile exact-key shapes without invoking accessors or thenables', () => {
    const getter = vi.fn(() => meta());
    const then = vi.fn();
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, 'kind', {
      value: 'fog-meta',
      enumerable: true,
    });
    Object.defineProperty(hostile, 'record', { get: getter, enumerable: true });

    expect(() => prepareFogAuthorityIntent(hostile as AuthorityMutation)).toThrow(TypeError);
    expect(getter).not.toHaveBeenCalled();
    const thenableRecord = meta() as FogMetaRecord & { then?: unknown };
    Object.defineProperty(thenableRecord, 'then', { get: then, enumerable: true });
    expect(() => prepareFogAuthorityIntent({ kind: 'fog-meta', record: thenableRecord })).toThrow(
      TypeError,
    );
    expect(then).not.toHaveBeenCalled();
    expect(() =>
      prepareFogAuthorityIntent({ kind: 'fog-meta', record: { ...meta(), extra: true } } as never),
    ).toThrow(TypeError);
    expect(() =>
      prepareFogAuthorityIntent({ kind: 'fog-patch', generation: 'generation-1', tiles: [] }),
    ).toThrow(TypeError);
  });

  it('rejects mutation/intent mismatches and preserves caller inputs', () => {
    const mutation = { kind: 'fog-meta' as const, record: meta() };
    const intent = prepareFogAuthorityIntent(mutation);
    if (intent === null) throw new Error('fixture');
    const original = structuredClone(mutation);
    const result = applyFogAuthorityIntent(null, { kind: 'fog-meta', record: meta(2) }, intent);

    expect(result).toEqual({ status: 'rejected', reason: 'invalid', current: null });
    expect(mutation).toEqual(original);
    expectDeepFrozen(result);
  });
});

describe('fog authority pure transitions', () => {
  it('initializes null, applies editor LWW, and rejects stale/equal records', () => {
    const initialized = acceptedState(apply(null, { kind: 'fog-meta', record: meta(1, 'a') }));
    expect(initialized).toEqual({ meta: meta(1, 'a'), tiles: [] });
    expectDeepFrozen(initialized);

    const tieWinner = acceptedState(apply(initialized, { kind: 'fog-meta', record: meta(1, 'b') }));
    expect(tieWinner?.meta.editor).toBe('b');
    expect(apply(tieWinner, { kind: 'fog-meta', record: meta(1, 'a') })).toEqual({
      status: 'rejected',
      reason: 'conflict',
      current: tieWinner,
    });
    expect(apply(tieWinner, { kind: 'fog-meta', record: meta(1, 'b') })).toEqual({
      status: 'rejected',
      reason: 'conflict',
      current: tieWinner,
    });
  });

  it('enforces same-generation geometry and resets tiles on generation replacement', () => {
    const withMeta = acceptedState(apply(null, { kind: 'fog-meta', record: meta() }));
    const withTile = acceptedState(
      apply(withMeta, {
        kind: 'fog-patch',
        generation: 'generation-1',
        tiles: [tile()],
      }),
    );
    const grown = acceptedState(
      apply(withTile, {
        kind: 'fog-meta',
        record: meta(2, 'dm', 'generation-1', { x: -128, y: 0, w: 256, h: 128 }),
      }),
    );
    expect(grown?.tiles).toHaveLength(1);

    const incompatible = {
      ...meta(3),
      definition: { ...definition(), cellSize: 2 },
    };
    expect(apply(grown, { kind: 'fog-meta', record: incompatible })).toEqual({
      status: 'rejected',
      reason: 'invalid',
      current: grown,
    });

    const replaced = acceptedState(
      apply(grown, { kind: 'fog-meta', record: meta(3, 'dm', 'generation-2') }),
    );
    expect(replaced).toEqual({ meta: meta(3, 'dm', 'generation-2'), tiles: [] });
  });

  it('canonicalizes tiles after compatible bounds growth', () => {
    const edgeDefinition = definition('generation-1', { x: 0, y: 0, w: 1, h: 1 });
    const edgeMeta: FogMetaRecord = { version: 1, editor: 'dm', definition: edgeDefinition };
    const edgeTile = tile();
    const edgeState = acceptedState(
      apply(acceptedState(apply(null, { kind: 'fog-meta', record: edgeMeta })), {
        kind: 'fog-patch',
        generation: 'generation-1',
        tiles: [edgeTile],
      }),
    );
    const grown = acceptedState(
      apply(edgeState, {
        kind: 'fog-meta',
        record: meta(2, 'dm', 'generation-1', { x: 0, y: 0, w: 128, h: 128 }),
      }),
    );
    expect(grown?.tiles).toEqual([edgeTile]);

    expectDeepFrozen(grown);
  });

  it('uses the editor tie-break for tiles and rejects patches without an active definition', () => {
    const withoutDefinition = acceptedState(
      apply(null, { kind: 'fog-meta', record: { version: 1, editor: 'dm' } }),
    );
    expect(
      apply(withoutDefinition, {
        kind: 'fog-patch',
        generation: 'generation-1',
        tiles: [tile()],
      }),
    ).toEqual({
      status: 'rejected',
      reason: 'generation-mismatch',
      current: withoutDefinition,
    });

    const current = acceptedState(
      apply(null, {
        kind: 'fog-meta',
        record: meta(1, 'dm', 'generation-1', { x: 0, y: 0, w: 256, h: 128 }),
      }),
    );
    const first = acceptedState(
      apply(current, {
        kind: 'fog-patch',
        generation: 'generation-1',
        tiles: [tile(0, 0, 1, 'a')],
      }),
    );
    const winner = acceptedState(
      apply(first, {
        kind: 'fog-patch',
        generation: 'generation-1',
        tiles: [tile(0, 0, 1, 'b')],
      }),
    );
    expect(winner?.tiles[0]?.editor).toBe('b');
  });

  it('atomically rejects empty, oversized, duplicate, stale, wrong-generation and invalid patches', () => {
    const current = acceptedState(
      apply(null, {
        kind: 'fog-meta',
        record: meta(1, 'dm', 'generation-1', { x: 0, y: 0, w: 256, h: 128 }),
      }),
    );
    const accepted = acceptedState(
      apply(current, {
        kind: 'fog-patch',
        generation: 'generation-1',
        tiles: [tile()],
      }),
    );
    const cases: readonly [AuthorityMutation, string][] = [
      [{ kind: 'fog-patch', generation: 'generation-1', tiles: [] }, 'invalid'],
      [
        {
          kind: 'fog-patch',
          generation: 'generation-1',
          tiles: Array.from({ length: 65 }, (_, x) => tile(x, 0, 1, 'dm', 'generation-1', false)),
        },
        'invalid',
      ],
      [{ kind: 'fog-patch', generation: 'generation-1', tiles: [tile(), tile()] }, 'invalid'],
      [{ kind: 'fog-patch', generation: 'generation-1', tiles: [tile()] }, 'conflict'],
      [
        {
          kind: 'fog-patch',
          generation: 'generation-1',
          tiles: [tile(1, 0, 1, 'dm', 'generation-1', false), tile()],
        },
        'conflict',
      ],
      [
        {
          kind: 'fog-patch',
          generation: 'generation-2',
          tiles: [tile(0, 0, 2, 'dm', 'generation-2')],
        },
        'generation-mismatch',
      ],
      [
        {
          kind: 'fog-patch',
          generation: 'generation-1',
          tiles: [tile(2, 0, 2, 'dm')],
        },
        'invalid',
      ],
      [
        {
          kind: 'fog-patch',
          generation: 'generation-1',
          tiles: [{ ...tile(0, 0, 2), data: data().slice(0, -1) + 'A' }],
        },
        'invalid',
      ],
      [
        {
          kind: 'fog-patch',
          generation: 'generation-1',
          tiles: [{ ...tile(0, 0, 2), data: encodeBase64(createTileBytes(false)) }],
        },
        'invalid',
      ],
    ];
    for (const [mutation, reason] of cases) {
      const result = applyRaw(accepted, mutation);
      expect(result).toEqual({ status: 'rejected', reason, current: accepted });
      expect(result.status === 'rejected' ? result.current : null).not.toBe(accepted);
    }
  });

  it('accepts 64 records, stores 256, and rejects a 257th without partial change', () => {
    const wide = meta(1, 'dm', 'generation-1', { x: 0, y: 0, w: 257 * 128, h: 128 });
    let current = acceptedState(apply(null, { kind: 'fog-meta', record: wide }));
    for (let start = 0; start < 256; start += 64) {
      current = acceptedState(
        apply(current, {
          kind: 'fog-patch',
          generation: 'generation-1',
          tiles: Array.from({ length: 64 }, (_, offset) =>
            tile(start + offset, 0, 1, 'dm', 'generation-1', false),
          ),
        }),
      );
    }
    expect(current?.tiles).toHaveLength(256);
    const overflow = apply(current, {
      kind: 'fog-patch',
      generation: 'generation-1',
      tiles: [tile(256, 0, 1, 'dm', 'generation-1', false)],
    });
    expect(overflow).toEqual({ status: 'rejected', reason: 'overloaded', current });
    expect(overflow.status === 'rejected' ? overflow.current : null).not.toBe(current);
  });
});

describe('fog authority adapters', () => {
  it('exposes the exact capability requirement and deterministic sorted batches', () => {
    const extension = createFogAuthorityServerExtension();
    expect(extension.requirement).toMatchObject({ key: 'fog', pluginName: 'fog', version: 1 });
    expect(extension.extensionKinds).toEqual([]);
    expect(extension.legacyKinds).toEqual(['fog-meta', 'fog-patch']);
    expect(extension.requirement.validate(null)).toBe(true);
    expect(extension.prepare({ kind: 'remove', id: 'x' })).toBeNull();

    const after: FogSnapshot = {
      meta: meta(1, 'dm', 'generation-1', { x: 0, y: 0, w: 130 * 128, h: 128 }),
      tiles: Array.from({ length: 130 }, (_, index) =>
        tile(129 - index, 0, 1, 'dm', 'generation-1', false),
      ),
    };
    const changes = extension.changes(null, after);
    expect(changes.map((change) => change.kind)).toEqual([
      'fog-meta',
      'fog-patch',
      'fog-patch',
      'fog-patch',
    ]);
    const patches = changes.filter(
      (change): change is Extract<AuthorityMutation, { kind: 'fog-patch' }> =>
        change.kind === 'fog-patch',
    );
    expect(patches.map((patch) => patch.tiles.length)).toEqual([64, 64, 2]);
    expect(patches.flatMap((patch) => patch.tiles.map((record) => record.x))).toEqual(
      Array.from({ length: 130 }, (_, index) => index),
    );
    expectDeepFrozen(changes);
  });

  it('installs checkpoints, reduces deltas, and rolls back on reducer failure', () => {
    const target = new AuthorityClientDocument([createFogAuthorityClientExtension()]);
    expect(target.checkpointRequirements).toHaveLength(1);
    expect(target.extensionKinds).toEqual(['fog-meta', 'fog-patch']);
    const checkpoint = target.installCheckpoint({
      cursor: { generation: 'room', streamId: 'stream', revision: 1 },
      elements: [],
      layers: [],
      extensions: { fog: { pluginName: 'fog', version: 1, data: null } },
    });
    expect(checkpoint.status).toBe('applied');

    const metaResult = target.applyChanges(
      { generation: 'room', streamId: 'stream', revision: 2 },
      [{ kind: 'fog-meta', record: meta() }],
    );
    expect(metaResult.status).toBe('applied');
    const patchResult = target.applyChanges(
      { generation: 'room', streamId: 'stream', revision: 3 },
      [{ kind: 'fog-patch', generation: 'generation-1', tiles: [tile()] }],
    );
    expect(patchResult.status).toBe('applied');
    const beforeFailure = target.getSnapshot();
    const failed = target.applyChanges({ generation: 'room', streamId: 'stream', revision: 4 }, [
      { kind: 'fog-patch', generation: 'generation-1', tiles: [tile()] },
    ]);
    expect(failed).toEqual({ status: 'recovery', reason: 'invalid', document: beforeFailure });
    expect(target.getSnapshot()).toBe(beforeFailure);
  });

  it('falls back to checkpoint for an unrepresentable delta', () => {
    const extension = createFogAuthorityServerExtension();
    const before = acceptedState(apply(null, { kind: 'fog-meta', record: meta() }));
    const after = before ? { ...before, tiles: [tile(0, 0, 1, 'dm')] } : null;
    const removedAgain = before;
    expect(extension.changes(after, removedAgain)).toEqual([]);
  });

  it('never invokes legacy controller or ledger mutation paths', () => {
    const applyMeta = vi.spyOn(FogLedger.prototype, 'applyMeta');
    const applyPatch = vi.spyOn(FogLedger.prototype, 'applyPatch');
    const handleRemote = vi.spyOn(FogSyncController.prototype, 'handleRemoteOp');
    const client = createFogAuthorityClientExtension();
    const server = createFogAuthorityServerExtension();
    expect(client.key).toBe('fog');
    expect(server.prepare({ kind: 'fog-meta', record: meta() })).not.toBeNull();
    expect(apply(null, { kind: 'fog-meta', record: meta() }).status).toBe('accepted');
    expect(applyMeta).not.toHaveBeenCalled();
    expect(applyPatch).not.toHaveBeenCalled();
    expect(handleRemote).not.toHaveBeenCalled();
  });
});
