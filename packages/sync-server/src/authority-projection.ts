import { isValidElement, isValidLayerRecord, parseAuthorityServerFrame } from '@fieldnotes/sync';
import type {
  AuthorityCursor,
  AuthorityMutation,
  LayerRecord,
  SyncElement,
} from '@fieldnotes/sync';
import { hashAuthorityJson } from './authority-json';
import type {
  AuthorityReadContext,
  AuthorityRoomDefinition,
  AuthorityState,
} from './authority-types';

function compareAuthorityIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function validState(state: AuthorityState, definition: AuthorityRoomDefinition): void {
  if (
    !state ||
    !Array.isArray(state.elements) ||
    !Array.isArray(state.layers) ||
    !state.extensions ||
    typeof state.extensions !== 'object' ||
    Array.isArray(state.extensions)
  )
    throw new TypeError('Invalid authority state');
  const ids = new Set<string>();
  for (const element of state.elements) {
    if (!isValidElement(element) || ids.has(element.id))
      throw new TypeError('Invalid authority element');
    ids.add(element.id);
  }
  ids.clear();
  for (const layer of state.layers) {
    if (!isValidLayerRecord(layer) || ids.has(layer.id))
      throw new TypeError('Invalid authority layer');
    ids.add(layer.id);
  }
  const expected = definition.extensions.map((extension) => extension.requirement.key).sort();
  const actual = Object.keys(state.extensions).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    throw new TypeError('Invalid authority extensions');
  for (const extension of definition.extensions) {
    const value = state.extensions[extension.requirement.key];
    if (
      !value ||
      value.pluginName !== extension.requirement.pluginName ||
      value.version !== extension.requirement.version ||
      !extension.requirement.validate(value.data)
    )
      throw new TypeError('Invalid authority extension');
  }
  hashAuthorityJson(state);
}

export interface AuthorityVisibleState {
  readonly state: AuthorityState;
  readonly hash: string;
}

/** Consume a complete pinned image, never a later backend read. */
export function projectAuthorityState(
  definition: AuthorityRoomDefinition,
  context: AuthorityReadContext,
  source: AuthorityState,
): AuthorityVisibleState {
  validState(source, definition);
  const input = structuredClone(source);
  let output: AuthorityState;
  let ownerVisible: boolean;
  try {
    output = definition.project(context, input);
    ownerVisible = definition.canReadOwnerId(context);
  } catch {
    throw new TypeError('Authority projection failed');
  }
  validState(output, definition);
  const originals = new Map(source.elements.map((element) => [element.id, element]));
  const originalLayers = new Map(source.layers.map((layer) => [layer.id, layer]));
  for (const element of output.elements) {
    const original = originals.get(element.id);
    if (!original || hashAuthorityJson(original) !== hashAuthorityJson(element))
      throw new TypeError('Authority projection introduced element');
  }
  for (const layer of output.layers) {
    const original = originalLayers.get(layer.id);
    if (!original || hashAuthorityJson(original) !== hashAuthorityJson(layer))
      throw new TypeError('Authority projection introduced layer');
  }
  const elements: SyncElement[] = output.elements
    .map((element) => {
      const clone = structuredClone(element) as SyncElement;
      if (!ownerVisible) delete clone.ownerId;
      return clone;
    })
    .sort((a, b) => compareAuthorityIds(a.id, b.id));
  const layers: LayerRecord[] = output.layers
    .map((layer) => structuredClone(layer))
    .sort((a, b) => compareAuthorityIds(a.id, b.id));
  const state: AuthorityState = {
    elements,
    layers,
    extensions: structuredClone(output.extensions),
  };
  return { state, hash: hashAuthorityJson(state) };
}

export type AuthorityProjectedChange =
  | {
      readonly status: 'silent';
      readonly before: AuthorityVisibleState;
      readonly after: AuthorityVisibleState;
    }
  | {
      readonly status: 'changes';
      readonly before: AuthorityVisibleState;
      readonly after: AuthorityVisibleState;
      readonly mutations: readonly AuthorityMutation[];
    }
  | {
      readonly status: 'checkpoint';
      readonly before: AuthorityVisibleState;
      readonly after: AuthorityVisibleState;
    };

function equivalent(a: unknown, b: unknown): boolean {
  return hashAuthorityJson(a) === hashAuthorityJson(b);
}

function layerMutation(layer: LayerRecord): AuthorityMutation {
  return layer.definition
    ? {
        kind: 'layer-upsert',
        layer: layer.definition,
        version: layer.version,
        editor: layer.editor,
      }
    : { kind: 'layer-remove', id: layer.id, version: layer.version, editor: layer.editor };
}

export function projectAuthorityChange(
  definition: AuthorityRoomDefinition,
  context: AuthorityReadContext,
  before: AuthorityState,
  after: AuthorityState,
  cursor: AuthorityCursor,
): AuthorityProjectedChange {
  const oldVisible = projectAuthorityState(definition, context, before);
  const newVisible = projectAuthorityState(definition, context, after);
  if (oldVisible.hash === newVisible.hash)
    return { status: 'silent', before: oldVisible, after: newVisible };
  const mutations: AuthorityMutation[] = [];
  const oldElements = new Map(oldVisible.state.elements.map((element) => [element.id, element]));
  const newElements = new Map(newVisible.state.elements.map((element) => [element.id, element]));
  for (const id of [...oldElements.keys()].sort(compareAuthorityIds))
    if (!newElements.has(id)) mutations.push({ kind: 'remove', id });
  for (const [id, element] of [...newElements].sort(([a], [b]) => compareAuthorityIds(a, b))) {
    if (!oldElements.has(id) || !equivalent(oldElements.get(id), element))
      mutations.push({ kind: 'upsert', element });
  }
  const oldLayers = new Map(oldVisible.state.layers.map((layer) => [layer.id, layer]));
  const newLayers = new Map(newVisible.state.layers.map((layer) => [layer.id, layer]));
  const fullAfterLayers = new Map(after.layers.map((layer) => [layer.id, layer]));
  for (const [id] of [...oldLayers].sort(([a], [b]) => compareAuthorityIds(a, b))) {
    if (!newLayers.has(id)) {
      const tombstone = fullAfterLayers.get(id);
      if (!tombstone || tombstone.definition)
        return { status: 'checkpoint', before: oldVisible, after: newVisible };
      mutations.push(layerMutation(tombstone));
    }
  }
  for (const [id, layer] of [...newLayers].sort(([a], [b]) => compareAuthorityIds(a, b))) {
    if (!oldLayers.has(id) || !equivalent(oldLayers.get(id), layer))
      mutations.push(layerMutation(layer));
  }
  for (const extension of definition.extensions) {
    const key = extension.requirement.key;
    const oldData = oldVisible.state.extensions[key]?.data;
    const newData = newVisible.state.extensions[key]?.data;
    if (equivalent(oldData, newData)) continue;
    let changes: readonly AuthorityMutation[];
    try {
      changes = extension.changes(oldData, newData);
    } catch {
      throw new TypeError('Authority extension projection failed');
    }
    if (!Array.isArray(changes)) throw new TypeError('Invalid authority extension changes');
    // Validate the complete callback result before deciding whether it fits a wire frame.
    hashAuthorityJson(changes);
    if (changes.length === 0)
      return { status: 'checkpoint', before: oldVisible, after: newVisible };
    for (const mutation of changes) {
      if (
        !mutation ||
        typeof mutation !== 'object' ||
        Object.keys(mutation).length !== 3 ||
        !Object.hasOwn(mutation, 'payload') ||
        mutation.kind !== 'extension' ||
        !extension.extensionKinds.includes(mutation.extensionKind)
      )
        throw new TypeError('Invalid authority extension mutation');
      mutations.push(mutation);
    }
  }
  if (mutations.length > 1024)
    return { status: 'checkpoint', before: oldVisible, after: newVisible };
  const encoded = JSON.stringify({
    protocol: 'authority:1',
    kind: 'changes',
    cursor,
    mutations,
  });
  if (Buffer.byteLength(encoded, 'utf8') > 1_048_576)
    return { status: 'checkpoint', before: oldVisible, after: newVisible };
  if (!parseAuthorityServerFrame(encoded)) throw new TypeError('Invalid authority changes frame');
  return { status: 'changes', before: oldVisible, after: newVisible, mutations };
}
