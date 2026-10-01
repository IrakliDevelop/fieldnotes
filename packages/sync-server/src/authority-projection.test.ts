import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { serializeAuthorityFrame } from '@fieldnotes/sync';
import type {
  AuthorityRoomDefinition,
  AuthorityReadContext,
  AuthorityState,
} from './authority-types';
import { projectAuthorityChange, projectAuthorityState } from './authority-projection';
import { measureAuthorityJson } from './authority-json';

const element = (id: string, audience = 'public') => ({
  id,
  type: 'shape' as const,
  position: { x: 0, y: 0 },
  zIndex: 0,
  locked: false,
  layerId: 'layer',
  shape: 'rectangle' as const,
  size: { w: 1, h: 1 },
  strokeColor: 'red',
  strokeWidth: 1,
  fillColor: 'blue',
  audience,
  ownerId: 'private-owner',
});
const context = {
  room: 'table',
  actorId: 'reader',
  ownershipId: 'reader',
  connectionId: 'peer',
  definitionId: 'definition',
  deadlineAt: Date.now() + 5000,
  signal: new AbortController().signal,
} as AuthorityReadContext;
const cursor = { generation: 'g', streamId: 's'.repeat(32), revision: 1 };
const extension = {
  requirement: {
    key: 'synthetic',
    pluginName: 'test',
    version: 1,
    validate: (data: unknown) => typeof data === 'number',
  },
  extensionKinds: ['synthetic-change'],
  prepare: () => null,
  changes: (_before: unknown, after: unknown) => [
    { kind: 'extension' as const, extensionKind: 'synthetic-change', payload: after },
  ],
};
const definition: AuthorityRoomDefinition = {
  id: 'definition',
  extensions: [extension],
  project: (_context, state) => ({
    ...state,
    elements: state.elements.filter((item) => item.audience !== 'hidden'),
  }),
  canReadOwnerId: () => false,
};
const state = (elements: AuthorityState['elements'], data = 0): AuthorityState => ({
  elements,
  layers: [],
  extensions: { synthetic: { pluginName: 'test', version: 1, data } },
});
const layer = (id: string, version = 1) => ({
  id,
  version,
  editor: 'dm',
  definition: { id, name: id, visible: true, locked: false, order: 0, opacity: 1 },
});
const unicodeIds = ['A', 'a', 'e\u0301', '\u00e9', '\u{10000}', '\ue000'];
const permute = <T>(items: readonly T[]): T[][] =>
  items.length === 0
    ? [[]]
    : items.flatMap((item, index) =>
        permute(items.filter((_, candidate) => candidate !== index)).map((tail) => [item, ...tail]),
      );
const canonicalBytes = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalBytes).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalBytes((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  return JSON.stringify(value);
};

describe('commit-coherent authority projection', () => {
  it('accepts independent small callback output after a large cloned input is enlarged', () => {
    const largeInput: AuthorityState = {
      elements: [],
      layers: [],
      extensions: { synthetic: { pluginName: 'test', version: 1, data: 'x'.repeat(18_000_000) } },
    };
    const independent: AuthorityState = state([], 0);
    let invoked = false;
    const projecting: AuthorityRoomDefinition = {
      ...definition,
      extensions: [
        { ...extension, requirement: { ...extension.requirement, validate: () => true } },
      ],
      project: (_context, input) => {
        invoked = true;
        expect(input).not.toBe(largeInput);
        const mutable = input as {
          extensions: Record<string, { pluginName: string; version: number; data: unknown }>;
        };
        mutable.extensions.synthetic = {
          pluginName: 'test',
          version: 1,
          data: 'z'.repeat(19_000_000),
        };
        return independent;
      },
    };
    const visible = projectAuthorityState(projecting, context, largeInput);
    expect(visible.state).toEqual(independent);
    expect(visible.state).not.toBe(independent);
    expect(invoked).toBe(true);
    expect(largeInput.extensions.synthetic?.data).toBe('x'.repeat(18_000_000));
  }, 30_000);
  it('preserves exact Unicode identities and canonicalizes every element/layer permutation', () => {
    const ids = ['\u00e9', 'e\u0301', '\u{10000}', '\ue000'];
    const expectedIds = ['e\u0301', '\u00e9', '\u{10000}', '\ue000'];
    const base: AuthorityState = {
      elements: ids.map((id) => element(id)),
      layers: ids.map((id) => layer(id)),
      extensions: { synthetic: { pluginName: 'test', version: 1, data: 0 } },
    };
    const expectedState = {
      elements: expectedIds.map((id) => {
        const { ownerId, ...visible } = element(id);
        expect(ownerId).toBe('private-owner');
        return visible;
      }),
      extensions: base.extensions,
      layers: expectedIds.map((id) => layer(id)),
    };
    const expectedHash = createHash('sha256').update(canonicalBytes(expectedState)).digest('hex');
    for (const elements of permute(base.elements)) {
      for (const layers of permute(base.layers)) {
        const input = { ...base, elements, layers };
        const projected = projectAuthorityState(definition, context, input);
        expect(projected.state).toEqual(expectedState);
        expect(projected.hash).toBe(expectedHash);
        expect(projectAuthorityState(definition, context, projected.state)).toEqual(projected);
      }
    }
    expect(base.elements.map((item) => item.id)).toEqual(ids);
    expect(base.layers.map((item) => item.id)).toEqual(ids);
    expect(
      projectAuthorityChange(
        definition,
        context,
        base,
        { ...base, elements: [...base.elements].reverse(), layers: [...base.layers].reverse() },
        cursor,
      ).status,
    ).toBe('silent');
  });

  it('orders UTF-16 IDs through projected arrays and emitted mutations', () => {
    const reversed = [...unicodeIds].reverse();
    const populated = {
      ...state(reversed.map((id) => element(id))),
      layers: reversed.map((id) => layer(id)),
    };
    const projected = projectAuthorityState(definition, context, populated);
    expect(projected.state.elements.map((item) => item.id)).toEqual(unicodeIds);
    expect(projected.state.layers.map((item) => item.id)).toEqual(unicodeIds);
    const added = projectAuthorityChange(definition, context, state([]), populated, cursor);
    expect(added.status).toBe('changes');
    if (added.status !== 'changes') return;
    expect(
      added.mutations.map((mutation) =>
        mutation.kind === 'upsert'
          ? mutation.element.id
          : mutation.kind === 'layer-upsert'
            ? mutation.layer.id
            : 'unexpected',
      ),
    ).toEqual([...unicodeIds, ...unicodeIds]);
    const removed = projectAuthorityChange(
      definition,
      context,
      populated,
      {
        ...state([]),
        layers: populated.layers.map(({ id }) => ({ id, version: 2, editor: 'dm' })),
      },
      cursor,
    );
    expect(removed.status).toBe('changes');
    if (removed.status === 'changes')
      expect(
        removed.mutations.map((mutation) =>
          mutation.kind === 'remove' || mutation.kind === 'layer-remove'
            ? mutation.id
            : 'unexpected',
        ),
      ).toEqual([...unicodeIds, ...unicodeIds]);
  });

  it('changes one collating-equivalent ID without merging its distinct peer', () => {
    const before = {
      ...state([element('\u00e9'), element('e\u0301')]),
      layers: [layer('\u00e9'), layer('e\u0301')],
    };
    const after = {
      ...before,
      elements: [element('e\u0301'), { ...element('\u00e9'), position: { x: 4, y: 0 } }],
      layers: [layer('e\u0301'), layer('\u00e9', 2)],
    };
    const change = projectAuthorityChange(definition, context, before, after, cursor);
    expect(change.status).toBe('changes');
    if (change.status === 'changes')
      expect(
        change.mutations.map((mutation) =>
          mutation.kind === 'upsert'
            ? mutation.element.id
            : mutation.kind === 'layer-upsert'
              ? mutation.layer.id
              : 'unexpected',
        ),
      ).toEqual(['\u00e9', '\u00e9']);
    expect(() =>
      projectAuthorityState(definition, context, state([element('\u00e9'), element('\u00e9')])),
    ).toThrow();
    expect(() =>
      projectAuthorityState(definition, context, {
        ...before,
        layers: [layer('e\u0301'), layer('e\u0301')],
      }),
    ).toThrow();
  });

  it('retains nested array and extension array order as visible state', () => {
    const arrayExtension = {
      ...definition,
      extensions: [
        {
          ...extension,
          requirement: {
            ...extension.requirement,
            validate: (data: unknown) => Array.isArray(data),
          },
          changes: () => [],
        },
      ],
    };
    const stroke = {
      id: 'e\u0301',
      type: 'stroke' as const,
      position: { x: 0, y: 0 },
      zIndex: 0,
      locked: false,
      layerId: 'layer',
      points: [
        { x: 1, y: 0, pressure: 1 },
        { x: 2, y: 0, pressure: 1 },
      ],
      color: 'red',
      width: 1,
      opacity: 1,
    };
    const before: AuthorityState = {
      ...state([stroke]),
      extensions: { synthetic: { pluginName: 'test', version: 1, data: ['first', 'second'] } },
    };
    const nested = { ...before, elements: [{ ...stroke, points: [...stroke.points].reverse() }] };
    expect(projectAuthorityChange(arrayExtension, context, before, nested, cursor).status).toBe(
      'changes',
    );
    const extensionChanged = {
      ...before,
      extensions: { synthetic: { pluginName: 'test', version: 1, data: ['second', 'first'] } },
    };
    expect(
      projectAuthorityChange(arrayExtension, context, before, extensionChanged, cursor).status,
    ).toBe('checkpoint');
  });
  it('measures the real next cursor at the changes frame boundary', () => {
    const large = {
      ...definition,
      extensions: [
        {
          ...extension,
          requirement: {
            ...extension.requirement,
            validate: (data: unknown) => typeof data === 'string',
          },
        },
      ],
    };
    const before: AuthorityState = {
      elements: [],
      layers: [],
      extensions: { synthetic: { pluginName: 'test', version: 1, data: '' } },
    };
    const after = (size: number): AuthorityState => ({
      ...before,
      extensions: { synthetic: { pluginName: 'test', version: 1, data: 'x'.repeat(size) } },
    });
    const largeCursor = { generation: 'g'.repeat(128), streamId: 's'.repeat(32), revision: 10 };
    expect(
      projectAuthorityChange(large, context, before, after(1_048_350), largeCursor).status,
    ).toBe('checkpoint');
    const base = projectAuthorityChange(large, context, before, after(1), largeCursor);
    expect(base.status).toBe('changes');
    if (base.status !== 'changes') return;
    const overhead =
      Buffer.byteLength(
        JSON.stringify({
          protocol: 'authority:1',
          kind: 'changes',
          cursor: largeCursor,
          mutations: base.mutations,
        }),
        'utf8',
      ) - 1;
    const fitting = 1_048_576 - overhead;
    expect(projectAuthorityChange(large, context, before, after(fitting), largeCursor).status).toBe(
      'changes',
    );
    expect(
      projectAuthorityChange(large, context, before, after(fitting + 1), largeCursor).status,
    ).toBe('checkpoint');
    expect(
      projectAuthorityChange(large, context, before, after(fitting), {
        ...largeCursor,
        revision: 100,
      }).status,
    ).toBe('checkpoint');
  });
  it('keeps hidden-only changes silent and strips owner IDs from a visible upsert', () => {
    const before = state([element('visible'), element('private', 'hidden')]);
    const hiddenOnly = state([
      element('visible'),
      { ...element('private', 'hidden'), position: { x: 9, y: 0 } },
    ]);
    expect(projectAuthorityChange(definition, context, before, hiddenOnly, cursor).status).toBe(
      'silent',
    );
    const next = state([element('visible'), element('new'), element('private', 'hidden')]);
    const change = projectAuthorityChange(definition, context, before, next, cursor);
    expect(change.status).toBe('changes');
    if (change.status !== 'changes') return;
    expect(change.mutations).toHaveLength(1);
    expect(change.mutations[0]).toMatchObject({ kind: 'upsert', element: { id: 'new' } });
    expect(JSON.stringify(change.mutations)).not.toContain('private-owner');
  });

  it('uses extension changes and rejects project-created elements', () => {
    const change = projectAuthorityChange(definition, context, state([]), state([], 1), cursor);
    expect(change.status).toBe('changes');
    if (change.status === 'changes')
      expect(change.mutations[0]).toMatchObject({
        kind: 'extension',
        extensionKind: 'synthetic-change',
      });
    const malicious = {
      ...definition,
      project: (_context: AuthorityReadContext, input: AuthorityState) =>
        state([...input.elements, element('invented')]),
    };
    expect(() => projectAuthorityState(malicious, context, state([]))).toThrow();
  });

  it('turns visible-to-hidden into remove and hidden-to-visible into upsert', () => {
    const visible = state([element('one')]);
    const hidden = state([element('one', 'hidden')]);
    const disappearance = projectAuthorityChange(definition, context, visible, hidden, cursor);
    expect(disappearance.status).toBe('changes');
    if (disappearance.status === 'changes')
      expect(disappearance.mutations).toEqual([{ kind: 'remove', id: 'one' }]);
    const appearance = projectAuthorityChange(definition, context, hidden, visible, cursor);
    expect(appearance.status).toBe('changes');
    if (appearance.status === 'changes')
      expect(appearance.mutations[0]).toMatchObject({ kind: 'upsert', element: { id: 'one' } });
  });

  it('projects layer tombstones and requires checkpoint when a layer disappears without one', () => {
    const layer = {
      id: 'floor',
      version: 1,
      editor: 'dm',
      definition: {
        id: 'floor',
        name: 'Floor',
        visible: true,
        locked: false,
        order: 0,
        opacity: 1,
      },
    };
    const old = { ...state([]), layers: [layer] };
    const tombstone = { ...state([]), layers: [{ id: 'floor', version: 2, editor: 'dm' }] };
    const removed = projectAuthorityChange(definition, context, old, tombstone, cursor);
    expect(removed.status).toBe('changes');
    if (removed.status === 'changes')
      expect(removed.mutations).toContainEqual({
        kind: 'layer-remove',
        id: 'floor',
        version: 2,
        editor: 'dm',
      });
    const hideLayers: AuthorityRoomDefinition = {
      ...definition,
      project: (_context, input) => ({ ...input, layers: [] }),
    };
    expect(projectAuthorityChange(hideLayers, context, old, state([]), cursor).status).toBe(
      'silent',
    );
    const disappeared = projectAuthorityChange(definition, context, old, state([]), cursor);
    expect(disappeared.status).toBe('checkpoint');
  });

  it('falls back to checkpoint for unrepresentable extension changes and oversized batches', () => {
    const noChanges = { ...definition, extensions: [{ ...extension, changes: () => [] }] };
    expect(projectAuthorityChange(noChanges, context, state([]), state([], 1), cursor).status).toBe(
      'checkpoint',
    );
    const many = state(Array.from({ length: 1025 }, (_, index) => element(`e${index}`)));
    expect(projectAuthorityChange(definition, context, state([]), many, cursor).status).toBe(
      'checkpoint',
    );
  });

  it('checks exact inventory, duplicate IDs and malformed extension output', () => {
    expect(() =>
      projectAuthorityState(definition, context, { elements: [], layers: [], extensions: {} }),
    ).toThrow();
    expect(() =>
      projectAuthorityState(definition, context, state([element('same'), element('same')])),
    ).toThrow();
    const wrong = {
      ...definition,
      extensions: [
        {
          ...extension,
          changes: () => [
            { kind: 'extension' as const, extensionKind: 'someone-else', payload: 1 },
          ],
        },
      ],
    };
    expect(() => projectAuthorityChange(wrong, context, state([]), state([], 1), cursor)).toThrow();
  });

  it('rejects malformed owned extension output while retaining valid checkpoint recovery', () => {
    let getterCalls = 0;
    const projection = (changes: () => unknown) => ({
      ...definition,
      extensions: [{ ...extension, changes: changes as typeof extension.changes }],
    });
    for (const output of [
      { kind: 'extension', extensionKind: 'synthetic-change', payload: 1 },
      [{ kind: 'extension', extensionKind: 'synthetic-change' }],
      [{ kind: 'extension', extensionKind: 'synthetic-change', payload: undefined }],
      [{ kind: 'extension', extensionKind: 'synthetic-change', payload: Infinity }],
      [
        {
          kind: 'extension',
          extensionKind: 'synthetic-change',
          payload: {
            get bad() {
              getterCalls++;
              return 1;
            },
          },
        },
      ],
    ]) {
      expect(() =>
        projectAuthorityChange(
          projection(() => output),
          context,
          state([]),
          state([], 1),
          cursor,
        ),
      ).toThrow();
    }
    expect(getterCalls).toBe(0);
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(() =>
      projectAuthorityChange(
        projection(() => [
          { kind: 'extension', extensionKind: 'synthetic-change', payload: cycle },
        ]),
        context,
        state([]),
        state([], 1),
        cursor,
      ),
    ).toThrow();
    expect(
      projectAuthorityChange(
        projection(() => []),
        context,
        state([]),
        state([], 1),
        cursor,
      ).status,
    ).toBe('checkpoint');
  });

  it('validates later changed extensions after an earlier empty or oversized result', () => {
    const first = {
      ...extension,
      requirement: { ...extension.requirement, key: 'first', validate: () => true },
    };
    const second = {
      ...extension,
      requirement: { ...extension.requirement, key: 'second', validate: () => true },
      changes: () => [{ kind: 'extension' as const, extensionKind: 'wrong', payload: 1 }],
    };
    const make = (data: string): AuthorityState => ({
      elements: [],
      layers: [],
      extensions: {
        first: { pluginName: 'test', version: 1, data },
        second: { pluginName: 'test', version: 1, data },
      },
    });
    for (const changes of [
      () => [],
      () => [
        {
          kind: 'extension' as const,
          extensionKind: 'synthetic-change',
          payload: 'x'.repeat(1_100_000),
        },
      ],
    ]) {
      const checked = { ...definition, extensions: [{ ...first, changes }, second] };
      expect(() =>
        projectAuthorityChange(checked, context, make('old'), make('new'), cursor),
      ).toThrow('Invalid authority extension mutation');
    }
  });

  it('falls back before serializing a near-limit changed element or oversized extension payload', () => {
    const large = { ...element('large'), id: 'large', strokeColor: 'x'.repeat(19_000_000) };
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      const moved = { ...large, position: { x: 1, y: 0 } };
      expect(
        projectAuthorityChange(definition, context, state([large]), state([moved]), cursor).status,
      ).toBe('checkpoint');
      const largeExtension = {
        ...definition,
        extensions: [
          {
            ...extension,
            requirement: { ...extension.requirement, validate: () => true },
            changes: () => [
              {
                kind: 'extension' as const,
                extensionKind: 'synthetic-change',
                payload: 'x'.repeat(19_000_000),
              },
            ],
          },
        ],
      };
      expect(
        projectAuthorityChange(
          largeExtension,
          context,
          state([], 'old' as unknown as number),
          state([], 'new' as unknown as number),
          cursor,
        ).status,
      ).toBe('checkpoint');
      expect(
        stringify.mock.calls.every(([value]) => typeof value !== 'string' || value.length <= 8192),
      ).toBe(true);
    } finally {
      stringify.mockRestore();
    }
  }, 30_000);

  it('keeps the candidate batch at 1024 mutations and recovers at 1025', () => {
    const make = (count: number) => ({
      ...definition,
      extensions: [
        {
          ...extension,
          changes: () =>
            Array.from({ length: count }, (_, index) => ({
              kind: 'extension' as const,
              extensionKind: 'synthetic-change',
              payload: index,
            })),
        },
      ],
    });
    const fitting = projectAuthorityChange(make(1024), context, state([], 0), state([], 1), cursor);
    expect(fitting.status).toBe('changes');
    if (fitting.status === 'changes') expect(fitting.mutations).toHaveLength(1024);
    expect(
      projectAuthorityChange(make(1025), context, state([], 0), state([], 1), cursor).status,
    ).toBe('checkpoint');
  });

  it('matches additive byte/node preflight to whole Unicode and escaped envelopes', () => {
    const candidates = [
      { kind: 'extension' as const, extensionKind: 'synthetic-change', payload: { é: '\n🪐' } },
      { kind: 'extension' as const, extensionKind: 'synthetic-change', payload: '"\\\u0000' },
      { kind: 'extension' as const, extensionKind: 'synthetic-change', payload: 17 },
    ];
    const empty = measureAuthorityJson({
      protocol: 'authority:1',
      kind: 'changes',
      cursor,
      mutations: [],
    });
    for (const count of [0, 1, 3]) {
      const mutations = candidates.slice(0, count);
      const parts = mutations.map((mutation) => measureAuthorityJson(mutation));
      const additiveBytes =
        empty.bytes + parts.reduce((sum, part) => sum + part.bytes, 0) + Math.max(0, count - 1);
      const additiveNodes = empty.nodes + parts.reduce((sum, part) => sum + part.nodes, 0);
      const frame = {
        protocol: 'authority:1' as const,
        kind: 'changes' as const,
        cursor,
        mutations,
      };
      const whole = measureAuthorityJson(frame);
      expect([additiveBytes, additiveNodes]).toEqual([whole.bytes, whole.nodes]);
      if (count > 0)
        expect(Buffer.byteLength(serializeAuthorityFrame(frame), 'utf8')).toBe(additiveBytes);
    }
  });

  it('admits exact F escaped Unicode changes and recovers one byte over', () => {
    const changed: AuthorityRoomDefinition = {
      ...definition,
      extensions: [
        { ...extension, requirement: { ...extension.requirement, validate: () => true } },
      ],
    };
    const make = (data: string): AuthorityState => ({
      elements: [],
      layers: [],
      extensions: { synthetic: { pluginName: 'test', version: 1, data } },
    });
    const before = make('old');
    const base = projectAuthorityChange(changed, context, before, make(''), cursor);
    expect(base.status).toBe('changes');
    if (base.status !== 'changes') return;
    const baseFrame = {
      protocol: 'authority:1' as const,
      kind: 'changes' as const,
      cursor,
      mutations: base.mutations,
    };
    const prefix = '🪐\n'; // 4 UTF-8 bytes plus a two-byte JSON escape
    const exactPayload = prefix + 'x'.repeat(1_048_576 - measureAuthorityJson(baseFrame).bytes - 6);
    const exact = projectAuthorityChange(changed, context, before, make(exactPayload), cursor);
    expect(exact.status).toBe('changes');
    if (exact.status === 'changes') {
      const frame = { ...baseFrame, mutations: exact.mutations };
      expect(measureAuthorityJson(frame, 1_048_576, 524_289).bytes).toBe(1_048_576);
      expect(Buffer.byteLength(serializeAuthorityFrame(frame), 'utf8')).toBe(1_048_576);
    }
    expect(
      projectAuthorityChange(changed, context, before, make(`${exactPayload}x`), cursor).status,
    ).toBe('checkpoint');
  }, 30_000);

  it('projects two independent near-B evidence images while retaining both source roots', () => {
    const make = (text: string): AuthorityState => ({
      elements: [
        {
          id: 'large',
          type: 'note',
          position: { x: 0, y: 0 },
          zIndex: 0,
          locked: false,
          layerId: 'default',
          size: { w: 1, h: 1 },
          text,
          backgroundColor: 'white',
          textColor: 'black',
        },
      ],
      layers: [],
      extensions: { synthetic: { pluginName: 'test', version: 1, data: 0 } },
    });
    const before = make('a'.repeat(20_900_000));
    const after = make('b'.repeat(20_900_000));
    const old = measureAuthorityJson(before);
    const next = measureAuthorityJson(after);
    expect(before).not.toBe(after);
    expect(old.bytes).toBeGreaterThan(20_899_000);
    expect(next.bytes).toBeGreaterThan(20_899_000);
    expect(old.nodes).toBe(next.nodes);
    const roots: AuthorityState[] = [];
    const projecting: AuthorityRoomDefinition = {
      ...definition,
      project: (_context, input) => {
        roots.push(input);
        return input;
      },
    };
    const projected = projectAuthorityChange(projecting, context, before, after, cursor);
    expect(projected.status).toBe('checkpoint');
    expect(roots).toHaveLength(2);
    expect(roots[0]).not.toBe(before);
    expect(roots[1]).not.toBe(after);
    expect(roots[0]).not.toBe(roots[1]);
    console.info(
      `independent replay: before ${old.bytes} bytes/${old.nodes} nodes, after ${next.bytes} bytes/${next.nodes} nodes`,
    );
  }, 30_000);

  it('keeps an independent near-B hidden-only evidence change silent', () => {
    const make = (text: string): AuthorityState => ({
      elements: [
        {
          id: 'hidden',
          type: 'note',
          audience: 'hidden',
          position: { x: 0, y: 0 },
          zIndex: 0,
          locked: false,
          layerId: 'default',
          size: { w: 1, h: 1 },
          text,
          backgroundColor: 'white',
          textColor: 'black',
        },
      ],
      layers: [],
      extensions: { synthetic: { pluginName: 'test', version: 1, data: 0 } },
    });
    const before = make('a'.repeat(20_900_000));
    const after = make('b'.repeat(20_900_000));
    expect(projectAuthorityChange(definition, context, before, after, cursor).status).toBe(
      'silent',
    );
  }, 30_000);
});
