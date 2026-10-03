import type {
  AuthorityCheckpointExtension,
  AuthorityCheckpointRequirement,
} from './authority-checkpoint';
import { freezeJson, parseBoundedJson, serializeBoundedJson } from './authority-json';
import {
  MAX_AUTHORITY_CHECKPOINT_BYTES,
  MAX_AUTHORITY_JSON_DEPTH,
  MAX_AUTHORITY_JSON_NODES,
} from './authority-protocol';
import type { AuthorityMutation } from './authority-protocol';
import type { AuthorityReadonly } from './authority-client-types';
import type { ExtensionKind } from './sync-plugin';

const MAX_AUTHORITY_EXTENSION_KINDS = 256;
const RESERVED_AUTHORITY_MUTATION_KINDS: readonly string[] = [
  'upsert',
  'remove',
  'clear',
  'layer-upsert',
  'layer-remove',
  'fog-meta',
  'fog-patch',
  'extension',
];
const idPattern = /^[\x21-\x7e]{1,128}$/;
const jsonLimits = {
  bytes: MAX_AUTHORITY_CHECKPOINT_BYTES,
  depth: MAX_AUTHORITY_JSON_DEPTH,
  nodes: MAX_AUTHORITY_JSON_NODES,
} as const;

type LegacyKind = 'fog-meta' | 'fog-patch';
type LegacyMutation<K extends LegacyKind = LegacyKind> = Extract<AuthorityMutation, { kind: K }>;

const reducerHandle: unique symbol = Symbol('authority-extension-reducer');
const reducerState: unique symbol = Symbol('authority-extension-reducer-state');
const legacyReducerHandle: unique symbol = Symbol('authority-legacy-extension-reducer');
const legacyReducerState: unique symbol = Symbol('authority-legacy-extension-reducer-state');
const clientExtensionHandle: unique symbol = Symbol('authority-client-extension');

const invariantState = <T>(state: T): T => state;

interface AuthorityExtensionReducerHandle {
  readonly [reducerHandle]: true;
}

interface AuthorityLegacyExtensionReducerHandle {
  readonly [legacyReducerHandle]: true;
}

/** An opaque, payload-erased reducer handle created by createAuthorityExtensionReducer. */
export interface AuthorityExtensionReducer<TState> extends AuthorityExtensionReducerHandle {
  readonly [reducerState]: (state: TState) => TState;
}

/** An opaque legacy reducer handle limited to the two negotiated v3 fog mutation kinds. */
export interface AuthorityLegacyExtensionReducer<
  TState,
> extends AuthorityLegacyExtensionReducerHandle {
  readonly [legacyReducerState]: (state: TState) => TState;
}

export interface AuthorityClientExtension<TState = unknown> {
  readonly [clientExtensionHandle]: true;
  readonly key: string;
  readonly pluginName: string;
  readonly version: number;
  readonly validate: (data: unknown) => data is TState;
  readonly reducers: readonly AuthorityExtensionReducerHandle[];
  readonly legacyReducers: readonly AuthorityLegacyExtensionReducerHandle[];
}

interface InternalReducer {
  readonly extensionKind: string;
  readonly validatePayload: (payload: unknown) => boolean;
  readonly reduce: (state: unknown, payload: unknown) => unknown;
}

interface InternalLegacyReducer {
  readonly kind: LegacyKind;
  readonly reduce: (state: unknown, mutation: LegacyMutation) => unknown;
}

interface RegisteredExtension {
  readonly key: string;
  readonly pluginName: string;
  readonly version: number;
  readonly validate: (data: unknown) => boolean;
}

interface InternalClientExtension extends RegisteredExtension {
  readonly reducers: readonly AuthorityExtensionReducerHandle[];
  readonly legacyReducers: readonly AuthorityLegacyExtensionReducerHandle[];
}

interface OwnedReducer extends InternalReducer {
  readonly owner: RegisteredExtension;
}

interface OwnedLegacyReducer extends InternalLegacyReducer {
  readonly owner: RegisteredExtension;
}

const reducerDefinitions = new WeakMap<object, InternalReducer>();
const legacyReducerDefinitions = new WeakMap<object, InternalLegacyReducer>();
const clientExtensionDefinitions = new WeakMap<object, InternalClientExtension>();

function validId(value: unknown): value is string {
  return typeof value === 'string' && idPattern.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedCopy(value: unknown): unknown {
  const serialized = serializeBoundedJson(value, jsonLimits);
  const copy = parseBoundedJson(serialized, jsonLimits);
  if (copy === null && serialized !== 'null') throw new TypeError('Invalid authority extension');
  freezeJson(copy);
  return copy;
}

function define(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: false,
    writable: false,
  });
}

function invalid(): never {
  throw new TypeError('Invalid authority client extension');
}

function observeThenable(value: object | ((...args: never[]) => unknown)): boolean {
  let then: unknown;
  try {
    then = Reflect.get(value, 'then');
  } catch {
    return true;
  }
  if (typeof then !== 'function') return false;
  try {
    void Promise.resolve(value).then(undefined, () => undefined);
  } catch {
    // It remains an invalid synchronous reducer result.
  }
  return true;
}

function isExactlyTrue(value: unknown): value is true {
  if (value === true) return true;
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    observeThenable(value);
  }
  return false;
}

function checkedResult(owner: RegisteredExtension, callback: () => unknown): unknown {
  let result: unknown;
  try {
    result = callback();
  } catch {
    return invalid();
  }
  if (
    result !== null &&
    (typeof result === 'object' || typeof result === 'function') &&
    observeThenable(result)
  ) {
    return invalid();
  }
  let copy: unknown;
  try {
    copy = boundedCopy(result);
  } catch {
    return invalid();
  }
  let valid: unknown;
  try {
    valid = owner.validate(copy);
  } catch {
    return invalid();
  }
  if (!isExactlyTrue(valid)) return invalid();
  return copy;
}

export function createAuthorityExtensionReducer<TState, TPayload>(definition: {
  readonly kind: ExtensionKind<TPayload>;
  readonly reduce: (
    state: AuthorityReadonly<NoInfer<TState>>,
    payload: AuthorityReadonly<TPayload>,
  ) => TState;
}): AuthorityExtensionReducer<TState> {
  if (
    !isRecord(definition) ||
    !isRecord(definition.kind) ||
    !validId(definition.kind.extensionKind) ||
    !isRecord(definition.kind.codec) ||
    typeof definition.kind.codec.validate !== 'function' ||
    typeof definition.reduce !== 'function'
  ) {
    return invalid();
  }
  const handle: AuthorityExtensionReducer<TState> = Object.freeze({
    [reducerHandle]: true as const,
    [reducerState]: invariantState,
  });
  reducerDefinitions.set(handle, {
    extensionKind: definition.kind.extensionKind,
    validatePayload: definition.kind.codec.validate,
    reduce: definition.reduce as (state: unknown, payload: unknown) => unknown,
  });
  return handle;
}

export function createAuthorityLegacyExtensionReducer<TState, K extends LegacyKind>(definition: {
  readonly kind: K;
  readonly reduce: (
    state: AuthorityReadonly<NoInfer<TState>>,
    mutation: AuthorityReadonly<LegacyMutation<K>>,
  ) => TState;
}): AuthorityLegacyExtensionReducer<TState> {
  if (
    !isRecord(definition) ||
    (definition.kind !== 'fog-meta' && definition.kind !== 'fog-patch') ||
    typeof definition.reduce !== 'function'
  ) {
    return invalid();
  }
  const handle: AuthorityLegacyExtensionReducer<TState> = Object.freeze({
    [legacyReducerHandle]: true as const,
    [legacyReducerState]: invariantState,
  });
  legacyReducerDefinitions.set(handle, {
    kind: definition.kind,
    reduce: definition.reduce as (state: unknown, mutation: LegacyMutation) => unknown,
  });
  return handle;
}

export function createAuthorityClientExtension<TState>(definition: {
  readonly key: string;
  readonly pluginName: string;
  readonly version: number;
  readonly validate: (data: unknown) => data is TState;
  readonly reducers: readonly AuthorityExtensionReducer<TState>[];
  readonly legacyReducers?: readonly AuthorityLegacyExtensionReducer<TState>[];
}): AuthorityClientExtension<TState> {
  if (
    !isRecord(definition) ||
    !validId(definition.key) ||
    !validId(definition.pluginName) ||
    !Number.isSafeInteger(definition.version) ||
    definition.version < 1 ||
    typeof definition.validate !== 'function' ||
    !Array.isArray(definition.reducers) ||
    (definition.legacyReducers !== undefined && !Array.isArray(definition.legacyReducers))
  ) {
    return invalid();
  }
  const extension: AuthorityClientExtension<TState> = Object.freeze({
    [clientExtensionHandle]: true as const,
    key: definition.key,
    pluginName: definition.pluginName,
    version: definition.version,
    validate: definition.validate,
    reducers: Object.freeze([...definition.reducers]),
    legacyReducers: Object.freeze([...(definition.legacyReducers ?? [])]),
  });
  clientExtensionDefinitions.set(extension, {
    key: extension.key,
    pluginName: extension.pluginName,
    version: extension.version,
    validate: extension.validate,
    reducers: extension.reducers,
    legacyReducers: extension.legacyReducers,
  });
  return extension;
}

/** Immutable registration snapshot shared by the canonical document owner. */
export class AuthorityClientExtensionRegistry {
  readonly #extensions: readonly RegisteredExtension[];
  readonly #reducers: ReadonlyMap<string, OwnedReducer>;
  readonly #legacyReducers: ReadonlyMap<LegacyKind, OwnedLegacyReducer>;
  readonly #requirements: readonly AuthorityCheckpointRequirement[];
  readonly #extensionKinds: readonly string[];

  constructor(definitions: readonly AuthorityClientExtension[]) {
    if (!Array.isArray(definitions) || definitions.length > MAX_AUTHORITY_EXTENSION_KINDS) {
      throw new RangeError('Invalid authority extension inventory');
    }
    const extensions: RegisteredExtension[] = [];
    const byKey = new Map<string, RegisteredExtension>();
    const reducers = new Map<string, OwnedReducer>();
    const legacyReducers = new Map<LegacyKind, OwnedLegacyReducer>();
    const ownedKindNames = new Set<string>();
    let ownedKinds = 0;
    for (const supplied of definitions) {
      const definition = isRecord(supplied) ? clientExtensionDefinitions.get(supplied) : undefined;
      if (
        definition === undefined ||
        !validId(definition.key) ||
        !validId(definition.pluginName) ||
        !Number.isSafeInteger(definition.version) ||
        (definition.version as number) < 1 ||
        typeof definition.validate !== 'function' ||
        !Array.isArray(definition.reducers) ||
        !Array.isArray(definition.legacyReducers) ||
        byKey.has(definition.key)
      ) {
        invalid();
      }
      const key = definition.key;
      const pluginName = definition.pluginName;
      const version = definition.version as number;
      const validate = definition.validate as (data: unknown) => boolean;
      const owner: RegisteredExtension = Object.freeze({
        key,
        pluginName,
        version,
        validate,
      });
      extensions.push(owner);
      byKey.set(owner.key, owner);
      for (const handle of definition.reducers) {
        const reducer = isRecord(handle) ? reducerDefinitions.get(handle) : undefined;
        if (
          !reducer ||
          RESERVED_AUTHORITY_MUTATION_KINDS.includes(reducer.extensionKind) ||
          ownedKindNames.has(reducer.extensionKind)
        )
          invalid();
        ownedKinds += 1;
        if (ownedKinds > MAX_AUTHORITY_EXTENSION_KINDS) {
          throw new RangeError('Authority extension kind limit exceeded');
        }
        ownedKindNames.add(reducer.extensionKind);
        reducers.set(reducer.extensionKind, Object.freeze({ ...reducer, owner }));
      }
      for (const handle of definition.legacyReducers) {
        const reducer = isRecord(handle) ? legacyReducerDefinitions.get(handle) : undefined;
        if (!reducer || ownedKindNames.has(reducer.kind)) invalid();
        ownedKinds += 1;
        if (ownedKinds > MAX_AUTHORITY_EXTENSION_KINDS) {
          throw new RangeError('Authority extension kind limit exceeded');
        }
        ownedKindNames.add(reducer.kind);
        legacyReducers.set(reducer.kind, Object.freeze({ ...reducer, owner }));
      }
    }
    extensions.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    this.#extensions = Object.freeze(extensions);
    this.#reducers = reducers;
    this.#legacyReducers = legacyReducers;
    this.#extensionKinds = Object.freeze(
      [...ownedKindNames].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    this.#requirements = Object.freeze(
      extensions.map((entry) =>
        Object.freeze({
          key: entry.key,
          pluginName: entry.pluginName,
          version: entry.version,
          validate: entry.validate,
        }),
      ),
    );
  }

  get requirements(): readonly AuthorityCheckpointRequirement[] {
    return this.#requirements;
  }

  get extensionKinds(): readonly string[] {
    return this.#extensionKinds;
  }

  validateAndCopy(value: unknown): Readonly<Record<string, AuthorityCheckpointExtension>> {
    let copy: unknown;
    try {
      copy = boundedCopy(value);
    } catch {
      return invalid();
    }
    if (!isRecord(copy)) return invalid();
    const keys = Object.keys(copy).sort();
    if (
      keys.length !== this.#extensions.length ||
      !keys.every((key, index) => key === this.#extensions[index]?.key)
    ) {
      return invalid();
    }
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const owner of this.#extensions) {
      const entry = copy[owner.key];
      if (
        !isRecord(entry) ||
        Object.keys(entry).length !== 3 ||
        entry.pluginName !== owner.pluginName ||
        entry.version !== owner.version ||
        !Object.hasOwn(entry, 'data')
      ) {
        return invalid();
      }
      let valid: unknown;
      try {
        valid = owner.validate(entry.data);
      } catch {
        return invalid();
      }
      if (!isExactlyTrue(valid)) return invalid();
      define(
        result,
        owner.key,
        Object.freeze({
          pluginName: owner.pluginName,
          version: owner.version,
          data: entry.data,
        }),
      );
    }
    return Object.freeze(result) as Readonly<Record<string, AuthorityCheckpointExtension>>;
  }

  states(
    extensions: Readonly<Record<string, AuthorityCheckpointExtension>>,
  ): Readonly<Record<string, unknown>> {
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const owner of this.#extensions) {
      const entry = extensions[owner.key];
      if (!entry) return invalid();
      define(result, owner.key, entry.data);
    }
    return Object.freeze(result);
  }

  materialize(
    states: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, AuthorityCheckpointExtension>> {
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const owner of this.#extensions) {
      if (!Object.hasOwn(states, owner.key)) return invalid();
      define(
        result,
        owner.key,
        Object.freeze({
          pluginName: owner.pluginName,
          version: owner.version,
          data: states[owner.key],
        }),
      );
    }
    return Object.freeze(result) as Readonly<Record<string, AuthorityCheckpointExtension>>;
  }

  reduce(
    states: Readonly<Record<string, unknown>>,
    mutation: Extract<AuthorityMutation, { kind: 'extension' | LegacyKind }>,
  ): Readonly<Record<string, unknown>> {
    const owned =
      mutation.kind === 'extension'
        ? this.#reducers.get(mutation.extensionKind)
        : this.#legacyReducers.get(mutation.kind);
    if (!owned || !Object.hasOwn(states, owned.owner.key)) return invalid();

    let state: unknown;
    try {
      state = boundedCopy(states[owned.owner.key]);
    } catch {
      return invalid();
    }
    let result: unknown;
    if (mutation.kind === 'extension') {
      const reducer = owned as OwnedReducer;
      let payload: unknown;
      try {
        payload = boundedCopy(mutation.payload);
      } catch {
        return invalid();
      }
      let valid: unknown;
      try {
        valid = reducer.validatePayload(payload);
      } catch {
        return invalid();
      }
      if (!isExactlyTrue(valid)) return invalid();
      result = checkedResult(reducer.owner, () => reducer.reduce(state, payload));
    } else {
      const reducer = owned as OwnedLegacyReducer;
      let input: unknown;
      try {
        input = boundedCopy(mutation);
      } catch {
        return invalid();
      }
      result = checkedResult(reducer.owner, () => reducer.reduce(state, input as LegacyMutation));
    }
    const next: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const owner of this.#extensions) {
      define(next, owner.key, owner.key === owned.owner.key ? result : states[owner.key]);
    }
    return Object.freeze(next);
  }
}
