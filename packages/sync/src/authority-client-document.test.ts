import { describe, expect, it, vi } from 'vitest';
import { serializeBoundedJson } from './authority-json';
import {
  MAX_AUTHORITY_CHECKPOINT_BYTES,
  MAX_AUTHORITY_JSON_DEPTH,
  MAX_AUTHORITY_JSON_NODES,
} from './authority-protocol';
import { createExtensionKind } from './sync-plugin';
import {
  createAuthorityClientExtension,
  createAuthorityExtensionReducer,
  createAuthorityLegacyExtensionReducer,
} from './authority-client-extension';
import {
  AuthorityClientDocument,
  MAX_AUTHORITY_DOCUMENT_LISTENERS,
} from './authority-client-document';
import type { AuthorityCheckpointPayload } from './authority-checkpoint';
import type { AuthorityClientExtension } from './authority-client-extension';
import type { AuthorityMutation } from './authority-protocol';
import type { AuthorityReadonly } from './authority-client-types';
import type { LayerRecord, SyncElement } from './protocol';

function element(id: string, text = id): SyncElement {
  return {
    id,
    type: 'note',
    position: { x: 0, y: 0 },
    zIndex: 0,
    locked: false,
    layerId: 'default',
    size: { w: 10, h: 10 },
    text,
    backgroundColor: '#fff',
    textColor: '#000',
  };
}

function layer(id: string, version: number, editor: string, name = id): LayerRecord {
  return {
    id,
    version,
    editor,
    definition: { id, name, visible: true, locked: false, order: 0, opacity: 1 },
  };
}

const setKind = createExtensionKind<{ readonly value: number }>({
  extensionKind: 'counter.set',
  codec: {
    validate(value): value is { readonly value: number } {
      return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { value?: unknown }).value === 'number'
      );
    },
  },
});

function extension(
  extraReducers: readonly ReturnType<typeof createAuthorityExtensionReducer<number, never>>[] = [],
): AuthorityClientExtension<number> {
  return createAuthorityClientExtension({
    key: 'counter',
    pluginName: 'counter-plugin',
    version: 1,
    validate: (value): value is number => typeof value === 'number' && Number.isFinite(value),
    reducers: [
      createAuthorityExtensionReducer({
        kind: setKind,
        reduce: (_state: AuthorityReadonly<number>, payload) => payload.value,
      }),
      ...extraReducers,
    ],
  });
}

function checkpoint(
  overrides: Partial<AuthorityCheckpointPayload> = {},
): AuthorityCheckpointPayload {
  return {
    cursor: { generation: 'g', streamId: 's', revision: 3 },
    casToken: 'cas-3',
    elements: [element('original')],
    layers: [layer('base', 1, 'a')],
    extensions: {
      counter: { pluginName: 'counter-plugin', version: 1, data: 0 },
    },
    ...overrides,
  };
}

function applied(
  target: AuthorityClientDocument,
  payload = checkpoint(),
): AuthorityCheckpointPayload {
  const result = target.installCheckpoint(payload);
  if (result.status !== 'applied') throw new Error(`fixture: ${result.status}`);
  return result.document as AuthorityCheckpointPayload;
}

describe('AuthorityClientDocument atomic staging', () => {
  it('rolls back core, layer, extension, cursor, and notifications when the final reducer throws', () => {
    const failKind = createExtensionKind<Record<string, never>>({
      extensionKind: 'counter.fail',
      codec: { validate: (value): value is Record<string, never> => typeof value === 'object' },
    });
    const fail = createAuthorityExtensionReducer({
      kind: failKind,
      reduce: (_state: AuthorityReadonly<number>): number => {
        throw new Error('private reducer failure');
      },
    });
    const target = new AuthorityClientDocument([extension([fail])]);
    const before = applied(target);
    const beforeElements = before.elements;
    const beforeLayers = before.layers;
    const beforeExtensions = before.extensions;
    const beforeCursor = before.cursor;
    const listener = vi.fn();
    target.subscribe(listener);

    const result = target.applyChanges({ generation: 'g', streamId: 's', revision: 4 }, [
      { kind: 'upsert', element: element('new') },
      { kind: 'layer-remove', id: 'base', version: 2, editor: 'b' },
      { kind: 'extension', extensionKind: 'counter.set', payload: { value: 7 } },
      { kind: 'extension', extensionKind: 'counter.fail', payload: {} },
    ]);

    expect(result).toEqual({ status: 'recovery', reason: 'invalid', document: before });
    expect(target.getSnapshot()).toBe(before);
    expect(target.getSnapshot()?.elements).toBe(beforeElements);
    expect(target.getSnapshot()?.layers).toBe(beforeLayers);
    expect(target.getSnapshot()?.extensions).toBe(beforeExtensions);
    expect(target.getSnapshot()?.cursor).toBe(beforeCursor);
    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores duplicate/stale cursors and recovers on gaps, stream changes, or generations', () => {
    const target = new AuthorityClientDocument([extension()]);
    const before = applied(target);
    const listener = vi.fn();
    target.subscribe(listener);
    const mutation: AuthorityMutation = { kind: 'remove', id: 'original' };

    for (const cursor of [
      { generation: 'g', streamId: 's', revision: 3 },
      { generation: 'g', streamId: 's', revision: 2 },
    ]) {
      expect(target.applyChanges(cursor, [mutation])).toEqual({
        status: 'ignored',
        document: before,
      });
    }
    for (const cursor of [
      { generation: 'g', streamId: 's', revision: 5 },
      { generation: 'g', streamId: 'other', revision: 1 },
      { generation: 'other', streamId: 's', revision: 4 },
    ]) {
      expect(target.applyChanges(cursor, [mutation])).toEqual({
        status: 'recovery',
        reason: 'cursor',
        document: before,
      });
    }
    expect(target.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('applies elements in order, clears only elements, and sorts IDs by UTF-16 order', () => {
    const target = new AuthorityClientDocument([extension()]);
    applied(
      target,
      checkpoint({
        elements: [element('old')],
        layers: [layer('layer', 1, 'a')],
      }),
    );
    const result = target.applyChanges({ generation: 'g', streamId: 's', revision: 4 }, [
      { kind: 'upsert', element: element('z') },
      { kind: 'clear' },
      { kind: 'upsert', element: element('\u00e4') },
      { kind: 'upsert', element: element('Z') },
      { kind: 'upsert', element: element('a') },
      { kind: 'remove', id: 'missing' },
    ]);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') throw new Error('fixture');
    expect(result.document.elements.map((entry) => entry.id)).toEqual(['Z', 'a', '\u00e4']);
    expect(result.document.layers).toHaveLength(1);
    expect(result.document.casToken).toBeUndefined();
  });

  it('retains layer tombstones and applies only newer LWW records', () => {
    const target = new AuthorityClientDocument([extension()]);
    applied(target, checkpoint({ layers: [layer('x', 2, 'b')] }));
    const first = target.applyChanges({ generation: 'g', streamId: 's', revision: 4 }, [
      { kind: 'layer-remove', id: 'x', version: 1, editor: 'z' },
      { kind: 'layer-remove', id: 'x', version: 2, editor: 'a' },
      { kind: 'layer-remove', id: 'x', version: 2, editor: 'c' },
    ]);
    expect(first.status).toBe('applied');
    if (first.status !== 'applied') throw new Error('fixture');
    expect(first.document.layers).toEqual([{ id: 'x', version: 2, editor: 'c' }]);

    const staleDefinition = layer('x', 1, 'ignored').definition;
    if (!staleDefinition) throw new Error('fixture');
    const second = target.applyChanges({ generation: 'g', streamId: 's', revision: 5 }, [
      {
        kind: 'layer-upsert',
        layer: staleDefinition,
        version: 1,
        editor: 'z',
      },
    ]);
    expect(second.status).toBe('applied');
    if (second.status !== 'applied') throw new Error('fixture');
    expect(second.document.layers).toEqual([{ id: 'x', version: 2, editor: 'c' }]);
  });

  it('invalidates checkpoint CAS for a contiguous semantic no-op', () => {
    const target = new AuthorityClientDocument([extension()]);
    const before = applied(target);
    const result = target.applyChanges({ generation: 'g', streamId: 's', revision: 4 }, [
      { kind: 'remove', id: 'absent' },
    ]);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') throw new Error('fixture');
    expect(result.document).not.toBe(before);
    expect(result.document.casToken).toBeUndefined();
    expect(result.document.cursor.revision).toBe(4);
  });

  it('requires the exact extension inventory on checkpoint installation', () => {
    const target = new AuthorityClientDocument([extension()]);
    expect(target.checkpointRequirements).toHaveLength(1);
    expect(target.installCheckpoint(checkpoint({ extensions: {} }))).toEqual({
      status: 'recovery',
      reason: 'invalid',
      document: null,
    });
    expect(
      target.installCheckpoint(
        checkpoint({
          extensions: {
            counter: { pluginName: 'wrong', version: 1, data: 0 },
          },
        }),
      ),
    ).toEqual({ status: 'recovery', reason: 'invalid', document: null });
  });

  it('supports snapshot-only and legacy reducers without plugin callbacks', () => {
    const snapshotOnly = createAuthorityClientExtension({
      key: 'snapshot',
      pluginName: 'snapshot',
      version: 1,
      validate: (value): value is { label: string } =>
        typeof value === 'object' && value !== null && 'label' in value,
      reducers: [],
    });
    const legacy = createAuthorityClientExtension({
      key: 'fog',
      pluginName: 'fog',
      version: 1,
      validate: (value): value is number => typeof value === 'number',
      reducers: [],
      legacyReducers: [
        createAuthorityLegacyExtensionReducer({
          kind: 'fog-meta',
          reduce: (state: AuthorityReadonly<number>, mutation) => state + mutation.record.version,
        }),
      ],
    });
    const target = new AuthorityClientDocument([snapshotOnly, legacy]);
    applied(
      target,
      checkpoint({
        extensions: {
          snapshot: { pluginName: 'snapshot', version: 1, data: { label: 'fixed' } },
          fog: { pluginName: 'fog', version: 1, data: 2 },
        },
      }),
    );
    const result = target.applyChanges({ generation: 'g', streamId: 's', revision: 4 }, [
      { kind: 'fog-meta', record: { version: 3, editor: 'a' } },
    ]);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') throw new Error('fixture');
    expect(result.document.extensions.snapshot?.data).toEqual({ label: 'fixed' });
    expect(result.document.extensions.fog?.data).toBe(5);
  });

  it('rejects unknown kinds, invalid codec payloads, and invalid reducer outputs atomically', () => {
    const invalidKind = createExtensionKind<{ value: string }>({
      extensionKind: 'invalid-output',
      codec: {
        validate(value): value is { value: string } {
          return typeof value === 'object' && value !== null;
        },
      },
    });
    const target = new AuthorityClientDocument([
      extension([
        createAuthorityExtensionReducer({
          kind: invalidKind,
          reduce: () => Number.NaN,
        }),
      ]),
    ]);
    const before = applied(target);
    const mutations: AuthorityMutation[] = [
      { kind: 'extension', extensionKind: 'missing', payload: {} },
      { kind: 'extension', extensionKind: 'counter.set', payload: { value: 'bad' } },
      { kind: 'extension', extensionKind: 'invalid-output', payload: { value: 'x' } },
      { kind: 'fog-patch', generation: 'g', tiles: [] },
    ];
    for (const mutation of mutations) {
      expect(
        target.applyChanges({ generation: 'g', streamId: 's', revision: 4 }, [mutation]),
      ).toEqual({ status: 'recovery', reason: 'invalid', document: before });
      expect(target.getSnapshot()).toBe(before);
    }
  });

  it('enforces depth and node bounds before swapping', () => {
    const deepKind = createExtensionKind<{ depth: number }>({
      extensionKind: 'deep-output',
      codec: { validate: (value): value is { depth: number } => typeof value === 'object' },
    });
    const largeKind = createExtensionKind<Record<string, never>>({
      extensionKind: 'large-output',
      codec: { validate: (value): value is Record<string, never> => typeof value === 'object' },
    });
    const makeDeep = (depth: number): unknown => {
      let value: unknown = 0;
      for (let index = 0; index < depth; index += 1) value = { value };
      return value;
    };
    const bounded = createAuthorityClientExtension({
      key: 'bounded',
      pluginName: 'bounded',
      version: 1,
      validate: (_value): _value is unknown => true,
      reducers: [
        createAuthorityExtensionReducer({
          kind: deepKind,
          reduce: (_state: AuthorityReadonly<unknown>, payload) => makeDeep(payload.depth),
        }),
        createAuthorityExtensionReducer({
          kind: largeKind,
          reduce: (_state: AuthorityReadonly<unknown>): unknown =>
            new Array(MAX_AUTHORITY_JSON_NODES),
        }),
      ],
    });
    const target = new AuthorityClientDocument([bounded]);
    const before = applied(
      target,
      checkpoint({
        extensions: { bounded: { pluginName: 'bounded', version: 1, data: null } },
      }),
    );
    expect(
      target.applyChanges({ generation: 'g', streamId: 's', revision: 4 }, [
        {
          kind: 'extension',
          extensionKind: 'deep-output',
          payload: { depth: MAX_AUTHORITY_JSON_DEPTH + 1 },
        },
      ]),
    ).toEqual({ status: 'recovery', reason: 'invalid', document: before });
    expect(
      target.applyChanges({ generation: 'g', streamId: 's', revision: 4 }, [
        { kind: 'extension', extensionKind: 'large-output', payload: {} },
      ]),
    ).toEqual({ status: 'recovery', reason: 'invalid', document: before });
  });

  // Coverage instrumentation makes the 4 MiB exact-boundary checks slower on hosted Node.
  it('accepts the exact C2 byte ceiling and rejects one byte beyond it', () => {
    const bytes = createAuthorityClientExtension({
      key: 'bytes',
      pluginName: 'bytes',
      version: 1,
      validate: (value): value is string => typeof value === 'string',
      reducers: [],
    });
    const emptyPayload: AuthorityCheckpointPayload = {
      cursor: { generation: 'g', streamId: 's', revision: 0 },
      elements: [],
      layers: [],
      extensions: { bytes: { pluginName: 'bytes', version: 1, data: '' } },
    };
    const limits = {
      bytes: MAX_AUTHORITY_CHECKPOINT_BYTES,
      depth: MAX_AUTHORITY_JSON_DEPTH,
      nodes: MAX_AUTHORITY_JSON_NODES,
    } as const;
    const fixedBytes = new TextEncoder().encode(serializeBoundedJson(emptyPayload, limits)).length;
    const exactData = 'x'.repeat(MAX_AUTHORITY_CHECKPOINT_BYTES - fixedBytes);
    const exact = new AuthorityClientDocument([bytes]);
    expect(
      exact.installCheckpoint({
        ...emptyPayload,
        extensions: { bytes: { pluginName: 'bytes', version: 1, data: exactData } },
      }).status,
    ).toBe('applied');
    const tooLarge = new AuthorityClientDocument([bytes]);
    expect(
      tooLarge.installCheckpoint({
        ...emptyPayload,
        extensions: { bytes: { pluginName: 'bytes', version: 1, data: `${exactData}x` } },
      }),
    ).toEqual({ status: 'recovery', reason: 'invalid', document: null });
  }, 20_000);

  it('notifies a bounded listener snapshot after swap, isolating throws and reentrancy', () => {
    const target = new AuthorityClientDocument([extension()]);
    applied(target);
    const observations: number[] = [];
    let reentered = false;
    target.subscribe(() => {
      const revision = target.getSnapshot()?.cursor.revision;
      if (revision !== undefined) observations.push(revision);
      if (!reentered) {
        reentered = true;
        target.applyChanges({ generation: 'g', streamId: 's', revision: 5 }, [
          { kind: 'remove', id: 'absent' },
        ]);
      }
    });
    target.subscribe(() => {
      throw new Error('listener failure');
    });
    target.subscribe(() => {
      const revision = target.getSnapshot()?.cursor.revision;
      if (revision !== undefined) observations.push(revision);
    });

    expect(
      target.applyChanges({ generation: 'g', streamId: 's', revision: 4 }, [
        { kind: 'remove', id: 'absent' },
      ]).status,
    ).toBe('applied');
    expect(target.getSnapshot()?.cursor.revision).toBe(5);
    expect(observations).toEqual([4, 5, 5, 5]);

    const capacity = new AuthorityClientDocument([extension()]);
    const unsubscribes = Array.from({ length: MAX_AUTHORITY_DOCUMENT_LISTENERS }, () =>
      capacity.subscribe(() => undefined),
    );
    expect(() => capacity.subscribe(() => undefined)).toThrow(RangeError);
    unsubscribes[0]?.();
    expect(() => capacity.subscribe(() => undefined)).not.toThrow();
  });

  it('publishes deeply immutable snapshots and preserves state on null/failure recovery', () => {
    const target = new AuthorityClientDocument([extension()]);
    expect(
      target.applyChanges({ generation: 'g', streamId: 's', revision: 1 }, [
        { kind: 'remove', id: 'x' },
      ]),
    ).toEqual({ status: 'recovery', reason: 'missing-document', document: null });
    const before = applied(target);
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before.cursor)).toBe(true);
    expect(Object.isFrozen(before.elements)).toBe(true);
    expect(Object.isFrozen(before.elements[0])).toBe(true);
    expect(Object.isFrozen(before.extensions)).toBe(true);
    expect(Object.isFrozen(before.extensions.counter)).toBe(true);
    expect(() => {
      (before.cursor as { revision: number }).revision = 99;
    }).toThrow(TypeError);

    expect(
      target.installCheckpoint(
        checkpoint({
          cursor: { generation: 'g2', streamId: 's2', revision: 0 },
          elements: [element('duplicate'), element('duplicate')],
        }),
      ),
    ).toEqual({ status: 'recovery', reason: 'invalid', document: before });
    expect(target.getSnapshot()).toBe(before);
  });
});
