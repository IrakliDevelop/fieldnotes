import { describe, expect, it } from 'vitest';
import { createExtensionKind } from './sync-plugin';
import {
  AuthorityClientExtensionRegistry,
  createAuthorityClientExtension,
  createAuthorityExtensionReducer,
  createAuthorityLegacyExtensionReducer,
} from './authority-client-extension';
import type {
  AuthorityClientExtension,
  AuthorityExtensionReducer,
  AuthorityLegacyExtensionReducer,
} from './authority-client-extension';
import type { AuthorityReadonly } from './authority-client-types';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const incrementKind = createExtensionKind<{ readonly amount: number }>({
  extensionKind: 'counter.increment',
  codec: {
    validate(value): value is { readonly amount: number } {
      return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { amount?: unknown }).amount === 'number'
      );
    },
  },
});

const inferredReducer = createAuthorityExtensionReducer({
  kind: incrementKind,
  reduce(state: AuthorityReadonly<{ total: number; nested: { values: string[] } }>, payload) {
    const amount: number = payload.amount;
    return {
      total: state.total + amount,
      nested: { values: [...state.nested.values] },
    };
  },
});
const reducerInference: Equal<
  typeof inferredReducer,
  AuthorityExtensionReducer<{ total: number; nested: { values: string[] } }>
> = true;

const inferredLegacy = createAuthorityLegacyExtensionReducer({
  kind: 'fog-meta',
  reduce(state: AuthorityReadonly<{ revisions: number[] }>, mutation) {
    const version: number = mutation.record.version;
    return { revisions: [...state.revisions, version] };
  },
});
const legacyInference: Equal<
  typeof inferredLegacy,
  AuthorityLegacyExtensionReducer<{ revisions: number[] }>
> = true;

interface BaseState {
  readonly tag: string;
}

interface NarrowState extends BaseState {
  readonly required: string;
}

function assertOpaqueInvariantHandles(): void {
  const baseKind = createExtensionKind<Record<string, never>>({
    extensionKind: 'types.base',
    codec: { validate: (value): value is Record<string, never> => typeof value === 'object' },
  });
  const baseReducer = createAuthorityExtensionReducer({
    kind: baseKind,
    reduce: (state: AuthorityReadonly<BaseState>) => ({ tag: state.tag }),
  });
  const narrowReducer = createAuthorityExtensionReducer({
    kind: baseKind,
    reduce: (state: AuthorityReadonly<NarrowState>) => ({
      tag: state.tag,
      required: state.required,
    }),
  });
  const baseLegacy = createAuthorityLegacyExtensionReducer({
    kind: 'fog-meta',
    reduce: (state: AuthorityReadonly<BaseState>) => ({ tag: state.tag }),
  });
  const narrowLegacy = createAuthorityLegacyExtensionReducer({
    kind: 'fog-patch',
    reduce: (state: AuthorityReadonly<NarrowState>) => ({
      tag: state.tag,
      required: state.required,
    }),
  });

  // @ts-expect-error authority reducer handles are opaque and cannot be forged
  const forgedReducer: AuthorityExtensionReducer<BaseState> = {};
  // @ts-expect-error legacy reducer handles are opaque and cannot be forged
  const forgedLegacy: AuthorityLegacyExtensionReducer<BaseState> = {};
  // @ts-expect-error reducer state is invariant: narrow cannot stand in for base
  const narrowAsBase: AuthorityExtensionReducer<BaseState> = narrowReducer;
  // @ts-expect-error reducer state is invariant: base cannot return narrow state
  const baseAsNarrow: AuthorityExtensionReducer<NarrowState> = baseReducer;
  // @ts-expect-error legacy reducer state is invariant: narrow cannot stand in for base
  const narrowLegacyAsBase: AuthorityLegacyExtensionReducer<BaseState> = narrowLegacy;
  // @ts-expect-error legacy reducer state is invariant: base cannot return narrow state
  const baseLegacyAsNarrow: AuthorityLegacyExtensionReducer<NarrowState> = baseLegacy;

  createAuthorityClientExtension<BaseState>({
    key: 'types-base',
    pluginName: 'types-base',
    version: 1,
    validate: (value): value is BaseState => typeof value === 'object' && value !== null,
    reducers: [
      // @ts-expect-error an extension cannot accept a reducer requiring narrower state
      narrowReducer,
    ],
    legacyReducers: [
      // @ts-expect-error an extension cannot accept a legacy reducer requiring narrower state
      narrowLegacy,
    ],
  });

  void [
    forgedReducer,
    forgedLegacy,
    narrowAsBase,
    baseAsNarrow,
    narrowLegacyAsBase,
    baseLegacyAsNarrow,
  ];
}

void assertOpaqueInvariantHandles;

function counterExtension(
  reducers: readonly AuthorityExtensionReducer<{
    total: number;
    nested: { values: string[] };
  }>[] = [inferredReducer],
): AuthorityClientExtension<{ total: number; nested: { values: string[] } }> {
  return createAuthorityClientExtension({
    key: 'counter',
    pluginName: 'counter-plugin',
    version: 1,
    validate(value): value is { total: number; nested: { values: string[] } } {
      return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { total?: unknown }).total === 'number' &&
        Array.isArray((value as { nested?: { values?: unknown } }).nested?.values)
      );
    },
    reducers,
  });
}

describe('authority client extension definitions', () => {
  it('preserves recursive readonly state and codec payload inference in declarations', () => {
    expect([reducerInference, legacyInference]).toEqual([true, true]);
    expect(Object.isFrozen(inferredLegacy)).toBe(true);
  });

  it('snapshots definitions and exposes sorted exact checkpoint requirements', () => {
    const reducers = [inferredReducer];
    const definition = {
      key: 'counter',
      pluginName: 'counter-plugin',
      version: 1,
      validate(value: unknown): value is { total: number; nested: { values: string[] } } {
        return typeof value === 'object' && value !== null;
      },
      reducers,
    };
    const extension = createAuthorityClientExtension(definition);
    reducers.length = 0;
    definition.key = 'mutated';
    definition.pluginName = 'mutated';
    definition.version = 9;
    const registry = new AuthorityClientExtensionRegistry([extension]);

    expect(registry.requirements).toEqual([
      {
        key: 'counter',
        pluginName: 'counter-plugin',
        version: 1,
        validate: definition.validate,
      },
    ]);
    expect(
      registry.reduce(
        { counter: { total: 1, nested: { values: [] } } },
        {
          kind: 'extension',
          extensionKind: 'counter.increment',
          payload: { amount: 2 },
        },
      ),
    ).toEqual({ counter: { total: 3, nested: { values: [] } } });
  });

  it('exposes a frozen UTF-16-sorted snapshot of generic reducer kinds only', () => {
    const zeta = createAuthorityExtensionReducer({
      kind: createExtensionKind<null>({
        extensionKind: 'zeta',
        codec: { validate: (value): value is null => value === null },
      }),
      reduce: (state: AuthorityReadonly<number>) => state,
    });
    const alpha = createAuthorityExtensionReducer({
      kind: createExtensionKind<null>({
        extensionKind: 'Alpha',
        codec: { validate: (value): value is null => value === null },
      }),
      reduce: (state: AuthorityReadonly<number>) => state,
    });
    const registry = new AuthorityClientExtensionRegistry([
      createAuthorityClientExtension({
        key: 'owned',
        pluginName: 'owned',
        version: 1,
        validate: (value): value is number => typeof value === 'number',
        reducers: [zeta, alpha],
        legacyReducers: [
          createAuthorityLegacyExtensionReducer({
            kind: 'fog-meta',
            reduce: (state: AuthorityReadonly<number>) => state,
          }),
        ],
      }),
    ]);

    expect(registry.extensionKinds).toEqual(['Alpha', 'zeta']);
    expect(Object.isFrozen(registry.extensionKinds)).toBe(true);
    expect(registry.extensionKinds).toBe(registry.extensionKinds);
    expect(registry.extensionKinds).not.toContain('fog-meta');
  });

  it('rejects duplicate keys, generic kinds, legacy owners, and more than 256 owned kinds', () => {
    expect(
      () => new AuthorityClientExtensionRegistry([counterExtension(), counterExtension()]),
    ).toThrow(TypeError);

    const other = createAuthorityClientExtension({
      key: 'other',
      pluginName: 'other-plugin',
      version: 1,
      validate: (value): value is { total: number; nested: { values: string[] } } =>
        typeof value === 'object' && value !== null,
      reducers: [inferredReducer],
    });
    expect(() => new AuthorityClientExtensionRegistry([counterExtension(), other])).toThrow(
      TypeError,
    );

    const fogOwner = (key: string) =>
      createAuthorityClientExtension({
        key,
        pluginName: key,
        version: 1,
        validate: (value): value is number => typeof value === 'number',
        reducers: [],
        legacyReducers: [
          createAuthorityLegacyExtensionReducer({
            kind: 'fog-meta',
            reduce: (state: AuthorityReadonly<number>) => state + 1,
          }),
        ],
      });
    expect(
      () => new AuthorityClientExtensionRegistry([fogOwner('fog-a'), fogOwner('fog-b')]),
    ).toThrow(TypeError);

    const tooMany = Array.from({ length: 257 }, (_, index) =>
      createAuthorityExtensionReducer({
        kind: createExtensionKind<{ value: number }>({
          extensionKind: `kind-${String(index).padStart(3, '0')}`,
          codec: { validate: (value): value is { value: number } => typeof value === 'object' },
        }),
        reduce: (state: AuthorityReadonly<number>) => state,
      }),
    );
    expect(
      () =>
        new AuthorityClientExtensionRegistry([
          createAuthorityClientExtension({
            key: 'maximum',
            pluginName: 'maximum',
            version: 1,
            validate: (value): value is number => typeof value === 'number',
            reducers: tooMany.slice(0, 256),
          }),
        ]),
    ).not.toThrow();
    expect(
      () =>
        new AuthorityClientExtensionRegistry([
          createAuthorityClientExtension({
            key: 'large',
            pluginName: 'large',
            version: 1,
            validate: (value): value is number => typeof value === 'number',
            reducers: tooMany,
          }),
        ]),
    ).toThrow(RangeError);
  });

  it('allows a required snapshot-only extension and rejects unknown or missing owners', () => {
    const registry = new AuthorityClientExtensionRegistry([
      createAuthorityClientExtension({
        key: 'snapshot',
        pluginName: 'snapshot-plugin',
        version: 1,
        validate: (value): value is { label: string } =>
          typeof value === 'object' &&
          value !== null &&
          typeof (value as { label?: unknown }).label === 'string',
        reducers: [],
      }),
    ]);
    expect(
      registry.validateAndCopy({
        snapshot: { pluginName: 'snapshot-plugin', version: 1, data: { label: 'ok' } },
      }),
    ).toEqual({
      snapshot: { pluginName: 'snapshot-plugin', version: 1, data: { label: 'ok' } },
    });
    expect(() =>
      registry.reduce(
        { snapshot: { label: 'ok' } },
        {
          kind: 'extension',
          extensionKind: 'missing',
          payload: {},
        },
      ),
    ).toThrow(TypeError);
    expect(() =>
      registry.reduce(
        { snapshot: { label: 'ok' } },
        {
          kind: 'fog-meta',
          record: { version: 1, editor: 'a' },
        },
      ),
    ).toThrow(TypeError);
  });

  it('accepts heterogeneous extension state types after typed factory validation', () => {
    const labels = createAuthorityClientExtension({
      key: 'labels',
      pluginName: 'labels-plugin',
      version: 1,
      validate: (value): value is { labels: string[] } =>
        typeof value === 'object' &&
        value !== null &&
        Array.isArray((value as { labels?: unknown }).labels),
      reducers: [],
    });
    const registry = new AuthorityClientExtensionRegistry([counterExtension(), labels]);

    expect(registry.requirements.map(({ key }) => key)).toEqual(['counter', 'labels']);
    expect(() => new AuthorityClientExtensionRegistry([{ ...labels }])).toThrow(TypeError);
  });

  it('deeply freezes callback inputs and validates a copied output exactly once', () => {
    let codecCalls = 0;
    let reducerCalls = 0;
    let validatorCalls = 0;
    const kind = createExtensionKind<{ nested: { value: number } }>({
      extensionKind: 'deep',
      codec: {
        validate(value): value is { nested: { value: number } } {
          codecCalls += 1;
          return typeof value === 'object' && value !== null;
        },
      },
    });
    const registry = new AuthorityClientExtensionRegistry([
      createAuthorityClientExtension({
        key: 'deep',
        pluginName: 'deep',
        version: 1,
        validate(value): value is { nested: { value: number } } {
          validatorCalls += 1;
          return (
            typeof value === 'object' &&
            value !== null &&
            typeof (value as { nested?: { value?: unknown } }).nested?.value === 'number'
          );
        },
        reducers: [
          createAuthorityExtensionReducer({
            kind,
            reduce(state: AuthorityReadonly<{ nested: { value: number } }>, payload) {
              reducerCalls += 1;
              expect(Object.isFrozen(state)).toBe(true);
              expect(Object.isFrozen(state.nested)).toBe(true);
              expect(Object.isFrozen(payload)).toBe(true);
              expect(Object.isFrozen(payload.nested)).toBe(true);
              expect(() => {
                (state.nested as { value: number }).value = 99;
              }).toThrow(TypeError);
              expect(() => {
                (payload.nested as { value: number }).value = 99;
              }).toThrow(TypeError);
              return { nested: { value: state.nested.value + payload.nested.value } };
            },
          }),
        ],
      }),
    ]);
    const initial = registry.validateAndCopy({
      deep: { pluginName: 'deep', version: 1, data: { nested: { value: 2 } } },
    });
    validatorCalls = 0;
    const result = registry.reduce(
      { deep: initial.deep?.data as { nested: { value: number } } },
      { kind: 'extension', extensionKind: 'deep', payload: { nested: { value: 3 } } },
    );
    expect(result).toEqual({ deep: { nested: { value: 5 } } });
    expect({ codecCalls, reducerCalls, validatorCalls }).toEqual({
      codecCalls: 1,
      reducerCalls: 1,
      validatorCalls: 1,
    });
    expect(Object.isFrozen(result.deep)).toBe(true);
    expect(Object.isFrozen((result.deep as { nested: object }).nested)).toBe(true);
  });

  it.each([
    {
      name: 'throwing',
      reduce: () => {
        throw new Error('private reducer detail');
      },
    },
    { name: 'thenable', reduce: () => Promise.resolve({ total: 2, nested: { values: [] } }) },
    { name: 'invalid', reduce: () => ({ total: 'no', nested: { values: [] } }) },
    {
      name: 'hostile',
      reduce: () => Object.defineProperty({}, 'value', { enumerable: true, get: () => 1 }),
    },
  ])('rejects $name reducer output without exposing partial state', ({ reduce }) => {
    const reducer = createAuthorityExtensionReducer({
      kind: incrementKind,
      reduce: reduce as unknown as (
        state: AuthorityReadonly<{ total: number; nested: { values: string[] } }>,
        payload: AuthorityReadonly<{ amount: number }>,
      ) => { total: number; nested: { values: string[] } },
    });
    const registry = new AuthorityClientExtensionRegistry([counterExtension([reducer])]);
    const before = { counter: { total: 1, nested: { values: [] } } };
    expect(() =>
      registry.reduce(before, {
        kind: 'extension',
        extensionKind: 'counter.increment',
        payload: { amount: 1 },
      }),
    ).toThrow(TypeError);
    expect(before).toEqual({ counter: { total: 1, nested: { values: [] } } });
  });
});
