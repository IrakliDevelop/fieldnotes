import { isValidElement, isValidLayerRecord } from '@fieldnotes/sync';
import type {
  AuthorityCursor,
  AuthorityMutation,
  LayerRecord,
  SyncElement,
} from '@fieldnotes/sync';
import { hashAuthorityJson, measureAuthorityJson } from './authority-json';
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
  // Bound the complete returned tree before ID sets, Object.keys, or SDK-owned copies.
  hashAuthorityJson(state);
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
}

export interface AuthorityVisibleState {
  readonly state: AuthorityState;
  readonly hash: string;
}

/** Source lookup maps leave scope before the fifth independent visible image is cloned. */
function validateProjectedSubset(source: AuthorityState, output: AuthorityState): void {
  const originals = new Map<string, AuthorityState['elements'][number]>();
  for (const element of source.elements) originals.set(element.id, element);
  const originalLayers = new Map<string, AuthorityState['layers'][number]>();
  for (const layer of source.layers) originalLayers.set(layer.id, layer);
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
}

/** The callback input clone leaves this frame before the independent output is checked/copied. */
function invokeProjection(
  definition: AuthorityRoomDefinition,
  context: AuthorityReadContext,
  source: AuthorityState,
): AuthorityState {
  return definition.project(context, structuredClone(source));
}

/** Consume a complete pinned image, never a later backend read. */
export function projectAuthorityState(
  definition: AuthorityRoomDefinition,
  context: AuthorityReadContext,
  source: AuthorityState,
): AuthorityVisibleState {
  validState(source, definition);
  let output: AuthorityState;
  let ownerVisible: boolean;
  try {
    output = invokeProjection(definition, context, source);
    ownerVisible = definition.canReadOwnerId(context);
  } catch {
    throw new TypeError('Authority projection failed');
  }
  validState(output, definition);
  validateProjectedSubset(source, output);
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

/** The full-after tombstone lookup ends before any extension callback is entered. */
function diffLayerRemovals(
  before: readonly LayerRecord[],
  after: readonly LayerRecord[],
  fullAfter: readonly LayerRecord[],
  add: (mutation: AuthorityMutation) => void,
): boolean {
  const full = new Map<string, AuthorityState['layers'][number]>();
  for (const layer of fullAfter) full.set(layer.id, layer);
  let next = 0;
  let missingTombstone = false;
  for (const layer of before) {
    for (;;) {
      const candidate = after[next];
      if (!candidate || candidate.id >= layer.id) break;
      next++;
    }
    if (after[next]?.id === layer.id) continue;
    const tombstone = full.get(layer.id);
    if (!tombstone || tombstone.definition) missingTombstone = true;
    else add(layerMutation(tombstone));
  }
  return missingTombstone;
}

function validatedExtensionChanges(
  extension: AuthorityRoomDefinition['extensions'][number],
  oldData: unknown,
  newData: unknown,
  add: (mutation: AuthorityMutation) => void,
): boolean {
  let changes: readonly AuthorityMutation[];
  try {
    changes = extension.changes(oldData, newData);
  } catch {
    throw new TypeError('Authority extension projection failed');
  }
  if (!Array.isArray(changes)) throw new TypeError('Invalid authority extension changes');
  hashAuthorityJson(changes);
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
    add(mutation);
  }
  return changes.length === 0;
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
  let mutations: AuthorityMutation[] = [];
  let recovery = false;
  const emptyEnvelope = measureAuthorityJson(
    { protocol: 'authority:1', kind: 'changes', cursor, mutations: [] },
    1_048_576,
    524_289,
  );
  let completeBytes = emptyEnvelope.bytes;
  let completeNodes = emptyEnvelope.nodes;
  const add = (mutation: AuthorityMutation): void => {
    if (recovery) return;
    if (mutations.length >= 1024) {
      mutations = [];
      recovery = true;
      return;
    }
    const comma = mutations.length === 0 ? 0 : 1;
    try {
      const measured = measureAuthorityJson(
        mutation,
        1_048_576 - completeBytes - comma,
        524_289 - completeNodes,
      );
      completeBytes += measured.bytes + comma;
      completeNodes += measured.nodes;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      mutations = [];
      recovery = true;
      return;
    }
    mutations.push(mutation);
  };
  const oldElements = oldVisible.state.elements;
  const newElements = newVisible.state.elements;
  let next = 0;
  for (const element of oldElements) {
    for (;;) {
      const candidate = newElements[next];
      if (!candidate || candidate.id >= element.id) break;
      next++;
    }
    if (newElements[next]?.id !== element.id) add({ kind: 'remove', id: element.id });
  }
  next = 0;
  for (const element of newElements) {
    for (;;) {
      const candidate = oldElements[next];
      if (!candidate || candidate.id >= element.id) break;
      next++;
    }
    if (oldElements[next]?.id !== element.id || !equivalent(oldElements[next], element))
      add({ kind: 'upsert', element });
  }
  const oldLayers = oldVisible.state.layers;
  const newLayers = newVisible.state.layers;
  if (diffLayerRemovals(oldLayers, newLayers, after.layers, add)) recovery = true;
  next = 0;
  for (const layer of newLayers) {
    for (;;) {
      const candidate = oldLayers[next];
      if (!candidate || candidate.id >= layer.id) break;
      next++;
    }
    if (oldLayers[next]?.id !== layer.id || !equivalent(oldLayers[next], layer))
      add(layerMutation(layer));
  }
  for (const extension of definition.extensions) {
    const key = extension.requirement.key;
    const oldData = oldVisible.state.extensions[key]?.data;
    const newData = newVisible.state.extensions[key]?.data;
    if (equivalent(oldData, newData)) continue;
    if (validatedExtensionChanges(extension, oldData, newData, add)) recovery = true;
  }
  if (recovery) return { status: 'checkpoint', before: oldVisible, after: newVisible };
  // The additive preflight is exact; one complete traversal checks the final inert envelope.
  const complete = measureAuthorityJson(
    { protocol: 'authority:1', kind: 'changes', cursor, mutations },
    1_048_576,
    524_289,
  );
  if (complete.bytes !== completeBytes || complete.nodes !== completeNodes)
    throw new Error('Authority changes measurement mismatch');
  return { status: 'changes', before: oldVisible, after: newVisible, mutations };
}
