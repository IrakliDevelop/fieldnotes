import type {
  AuthorityCheckpointPayload,
  AuthorityCheckpointRequirement,
} from './authority-checkpoint';
import {
  AuthorityClientExtensionRegistry,
  type AuthorityClientExtension,
} from './authority-client-extension';
import { freezeJson, parseBoundedJson, serializeBoundedJson } from './authority-json';
import { classifyAuthorityCursor } from './authority-cursor';
import {
  MAX_AUTHORITY_CHECKPOINT_BYTES,
  MAX_AUTHORITY_JSON_DEPTH,
  MAX_AUTHORITY_JSON_NODES,
  isAuthorityCursor,
} from './authority-protocol';
import type { AuthorityCursor, AuthorityMutation } from './authority-protocol';
import type { AuthorityReadonly } from './authority-client-types';
import { isNewerLayerRecord, isValidElement, isValidLayerRecord } from './protocol';
import type { LayerRecord, SyncElement } from './protocol';

export const MAX_AUTHORITY_DOCUMENT_LISTENERS = 64;

const jsonLimits = {
  bytes: MAX_AUTHORITY_CHECKPOINT_BYTES,
  depth: MAX_AUTHORITY_JSON_DEPTH,
  nodes: MAX_AUTHORITY_JSON_NODES,
} as const;
const idPattern = /^[\x21-\x7e]{1,128}$/;

type Snapshot = AuthorityReadonly<AuthorityCheckpointPayload>;

export type AuthorityDocumentResult =
  | { readonly status: 'applied'; readonly document: Snapshot }
  | { readonly status: 'ignored'; readonly document: Snapshot }
  | {
      readonly status: 'recovery';
      readonly reason: 'missing-document' | 'cursor' | 'invalid';
      readonly document: Snapshot | null;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && idPattern.test(value);
}

function sorted<T extends { readonly id: string }>(values: Iterable<T>): T[] {
  return [...values].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function canonicalCopy(value: unknown): unknown {
  const serialized = serializeBoundedJson(value, jsonLimits);
  const copy = parseBoundedJson(serialized, jsonLimits);
  if (copy === null && serialized !== 'null') throw new TypeError('Invalid authority document');
  freezeJson(copy);
  return copy;
}

function applied(document: Snapshot): AuthorityDocumentResult {
  return Object.freeze({ status: 'applied' as const, document });
}

function ignored(document: Snapshot): AuthorityDocumentResult {
  return Object.freeze({ status: 'ignored' as const, document });
}

function recovery(
  document: Snapshot | null,
  reason: 'missing-document' | 'cursor' | 'invalid',
): AuthorityDocumentResult {
  return Object.freeze({ status: 'recovery' as const, reason, document });
}

export class AuthorityClientDocument {
  readonly #extensions: AuthorityClientExtensionRegistry;
  readonly #listeners = new Set<{ readonly listener: () => void }>();
  #document: Snapshot | null = null;

  constructor(extensions: readonly AuthorityClientExtension[] = []) {
    this.#extensions = new AuthorityClientExtensionRegistry(extensions);
  }

  get checkpointRequirements(): readonly AuthorityCheckpointRequirement[] {
    return this.#extensions.requirements;
  }

  getSnapshot(): Snapshot | null {
    return this.#document;
  }

  subscribe(listener: () => void): () => void {
    if (typeof listener !== 'function') throw new TypeError('Invalid authority document listener');
    if (this.#listeners.size >= MAX_AUTHORITY_DOCUMENT_LISTENERS) {
      throw new RangeError('Authority document listener limit exceeded');
    }
    const registration = Object.freeze({ listener });
    this.#listeners.add(registration);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#listeners.delete(registration);
    };
  }

  installCheckpoint(checkpoint: AuthorityCheckpointPayload): AuthorityDocumentResult {
    let candidate: Snapshot;
    try {
      candidate = this.#canonicalCheckpoint(checkpoint, true);
    } catch {
      return recovery(this.#document, 'invalid');
    }
    this.#document = candidate;
    this.#notify();
    return applied(candidate);
  }

  applyChanges(
    cursor: AuthorityCursor,
    mutations: readonly AuthorityMutation[],
  ): AuthorityDocumentResult {
    const before = this.#document;
    if (before === null) return recovery(null, 'missing-document');
    let classification: ReturnType<typeof classifyAuthorityCursor>;
    try {
      classification = classifyAuthorityCursor(before.cursor, cursor);
    } catch {
      return recovery(before, 'cursor');
    }
    if (classification === 'duplicate-or-stale') return ignored(before);
    if (classification !== 'next') return recovery(before, 'cursor');
    if (!Array.isArray(mutations) || mutations.length === 0 || mutations.length > 1_024) {
      return recovery(before, 'invalid');
    }

    try {
      const elements = new Map<string, SyncElement>();
      const layers = new Map<string, LayerRecord>();
      for (const element of before.elements) elements.set(element.id, element as SyncElement);
      for (const layer of before.layers) layers.set(layer.id, layer as LayerRecord);
      let states = this.#extensions.states(before.extensions);

      for (const mutation of mutations) {
        if (
          typeof mutation !== 'object' ||
          mutation === null ||
          typeof mutation.kind !== 'string'
        ) {
          throw new TypeError('Invalid authority mutation');
        }
        switch (mutation.kind) {
          case 'upsert':
            elements.set(mutation.element.id, mutation.element as SyncElement);
            break;
          case 'remove':
            elements.delete(mutation.id);
            break;
          case 'clear':
            elements.clear();
            break;
          case 'layer-upsert': {
            const incoming: LayerRecord = {
              id: mutation.layer.id,
              version: mutation.version,
              editor: mutation.editor,
              definition: mutation.layer,
            };
            if (!isValidLayerRecord(incoming)) throw new TypeError('Invalid authority layer');
            const current = layers.get(incoming.id);
            if (!current || isNewerLayerRecord(incoming, current))
              layers.set(incoming.id, incoming);
            break;
          }
          case 'layer-remove': {
            const incoming: LayerRecord = {
              id: mutation.id,
              version: mutation.version,
              editor: mutation.editor,
            };
            if (!isValidLayerRecord(incoming)) throw new TypeError('Invalid authority layer');
            const current = layers.get(incoming.id);
            if (!current || isNewerLayerRecord(incoming, current))
              layers.set(incoming.id, incoming);
            break;
          }
          case 'extension':
          case 'fog-meta':
          case 'fog-patch':
            states = this.#extensions.reduce(states, mutation);
            break;
          default:
            throw new TypeError('Invalid authority mutation');
        }
      }

      const candidate = this.#canonicalCheckpoint(
        {
          cursor,
          elements: sorted(elements.values()),
          layers: sorted(layers.values()),
          extensions: this.#extensions.materialize(states),
        },
        false,
      );
      this.#document = candidate;
      this.#notify();
      return applied(candidate);
    } catch {
      return recovery(before, 'invalid');
    }
  }

  #canonicalCheckpoint(value: unknown, validateExtensions: boolean): Snapshot {
    const copy = canonicalCopy(value);
    if (
      !isRecord(copy) ||
      !isAuthorityCursor(copy.cursor) ||
      (Object.hasOwn(copy, 'casToken') && !validId(copy.casToken)) ||
      !Array.isArray(copy.elements) ||
      !Array.isArray(copy.layers) ||
      !Object.hasOwn(copy, 'extensions') ||
      !Object.keys(copy).every((key) =>
        ['cursor', 'casToken', 'elements', 'layers', 'extensions'].includes(key),
      )
    ) {
      throw new TypeError('Invalid authority document');
    }
    const elementIds = new Set<string>();
    for (const element of copy.elements) {
      if (!isValidElement(element) || elementIds.has(element.id)) {
        throw new TypeError('Invalid authority element');
      }
      elementIds.add(element.id);
    }
    const layerIds = new Set<string>();
    for (const layer of copy.layers) {
      if (!isValidLayerRecord(layer) || layerIds.has(layer.id)) {
        throw new TypeError('Invalid authority layer');
      }
      layerIds.add(layer.id);
    }
    const extensions = validateExtensions
      ? this.#extensions.validateAndCopy(copy.extensions)
      : copy.extensions;
    if (!validateExtensions) {
      const expected = this.#extensions.requirements;
      if (!isRecord(extensions)) throw new TypeError('Invalid authority extensions');
      const keys = Object.keys(extensions).sort();
      if (
        keys.length !== expected.length ||
        !keys.every((key, index) => key === expected[index]?.key)
      ) {
        throw new TypeError('Invalid authority extensions');
      }
      for (const requirement of expected) {
        const entry = extensions[requirement.key];
        if (
          !isRecord(entry) ||
          entry.pluginName !== requirement.pluginName ||
          entry.version !== requirement.version ||
          !Object.hasOwn(entry, 'data')
        ) {
          throw new TypeError('Invalid authority extension');
        }
      }
    }
    const candidate = canonicalCopy({
      cursor: copy.cursor,
      ...(Object.hasOwn(copy, 'casToken') ? { casToken: copy.casToken } : {}),
      elements: sorted(copy.elements as SyncElement[]),
      layers: sorted(copy.layers as LayerRecord[]),
      extensions,
    });
    return candidate as Snapshot;
  }

  #notify(): void {
    const listeners = [...this.#listeners];
    for (const { listener } of listeners) {
      try {
        listener();
      } catch {
        // One subscriber cannot prevent later subscribers from observing the completed swap.
      }
    }
  }
}
