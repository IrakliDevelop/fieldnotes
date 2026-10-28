import { generateNKeysBetween } from '../core/fractional-index';
import type { Bounds } from '../core/types';
import type { LayerManager } from '../layers/layer-manager';
import { ElementStore } from './element-store';
import { getElementVisualBounds } from './element-bounds';
import { FRAME_ELEMENT_TYPE } from './frame-element';
import type { FrameElement } from './frame-element';
import { getHierarchyClosure } from './hierarchy-ops';
import type { ElementRegistry } from './element-registry';
import type { CanvasElement } from './types';

const HEADER_HEIGHT = 24;
const DEFAULT_PADDING = 24;

export interface FrameSelectionOptions {
  readonly title?: string;
  readonly color?: string;
  readonly padding?: number;
}

export interface FrameCommandPlan {
  readonly add?: FrameElement;
  readonly updates: readonly { readonly id: string; readonly partial: Partial<CanvasElement> }[];
  readonly removeId?: string;
}

function fail(message: string): never {
  throw new Error(`Cannot change frame membership: ${message}`);
}

function isFrame(element: CanvasElement | undefined): element is FrameElement {
  return element?.type === 'extension' && element.extensionType === FRAME_ELEMENT_TYPE;
}

function scene(store: ElementStore): readonly CanvasElement[] {
  const elements = store.getAll();
  if (elements.length !== store.count) fail('scene contains invalid remote hierarchy');
  return elements;
}

function requireIds(ids: readonly string[], store: ElementStore): void {
  if (ids.length === 0) fail('selection is empty');
  for (const id of ids) if (!store.getById(id)) fail(`element "${id}" is missing`);
}

function requireLayer(layerId: string, layers: LayerManager): void {
  const layer = layers.getLayer(layerId);
  if (!layer) fail(`layer "${layerId}" is missing`);
  if (layer.locked) fail(`layer "${layerId}" is locked`);
}

function roots(
  ids: readonly string[],
  store: ElementStore,
): ReturnType<typeof getHierarchyClosure> {
  requireIds(ids, store);
  const closure = getHierarchyClosure(ids, store);
  if (closure.roots.length === 0) fail('selection is empty');
  return closure;
}

function requireRootInputs(
  ids: readonly string[],
  closure: ReturnType<typeof getHierarchyClosure>,
  store: ElementStore,
): void {
  for (const id of ids) {
    const element = store.getById(id);
    if (!element || (element.parentId !== undefined && closure.rootIds.get(id) === id)) {
      fail('selection contains a non-root element');
    }
  }
}

function requireIncoming(
  closure: ReturnType<typeof getHierarchyClosure>,
  registry: ElementRegistry,
  layers: LayerManager,
): void {
  const layerId = closure.roots[0]?.layerId;
  if (!layerId) fail('selection is empty');
  requireLayer(layerId, layers);
  for (const root of closure.roots) {
    if (root.layerId !== layerId) fail('selection spans layers');
    if (root.locked) fail('selection contains a locked root');
  }
  for (const element of closure.elements) {
    if (element.layerId !== layerId) fail('selection spans layers');
    if (isFrame(element)) fail('selection contains a frame');
    if (element.type === 'extension' && registry.getAdapter(element.extensionType)?.fullCanvas) {
      fail('selection contains a full-canvas element');
    }
    const bounds = getElementVisualBounds(element, registry);
    if (!bounds || !finiteBounds(bounds)) fail('selection contains an unbounded element');
  }
}

function finiteBounds(bounds: Bounds): boolean {
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.w) &&
    Number.isFinite(bounds.h) &&
    bounds.w >= 0 &&
    bounds.h >= 0 &&
    Number.isFinite(bounds.x + bounds.w) &&
    Number.isFinite(bounds.y + bounds.h)
  );
}

function keysBetween(
  a: string | null,
  b: string | null,
  count: number,
  forbidden: Iterable<string>,
): string[] {
  try {
    const keys = generateNKeysBetween(a, b, count);
    const seen = new Set(forbidden);
    if (new Set(keys).size !== keys.length || keys.some((key) => seen.has(key))) {
      fail('generated order keys collide');
    }
    return keys;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Cannot change frame membership:'))
      throw error;
    fail('order keys cannot be generated');
  }
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedRoots(
  elements: readonly CanvasElement[],
  layerId: string,
  parentId?: string,
): CanvasElement[] {
  return elements
    .filter((element) => element.layerId === layerId && element.parentId === parentId)
    .sort((a, b) => compareStrings(a.index, b.index) || compareStrings(a.id, b.id));
}

function rehearsal(store: ElementStore, registry: ElementRegistry, plan: FrameCommandPlan): void {
  const isolated = new ElementStore(registry);
  isolated.loadSnapshot(structuredClone(store.snapshot()));
  if (plan.add) isolated.add(structuredClone(plan.add));
  if (plan.updates.length > 0) isolated.updateMany(structuredClone(plan.updates));
  if (plan.removeId) isolated.remove(plan.removeId);
}

function validatePlan(
  store: ElementStore,
  registry: ElementRegistry,
  plan: FrameCommandPlan,
): FrameCommandPlan {
  rehearsal(store, registry, plan);
  return plan;
}

function frameEnvelope(
  id: string,
  layerId: string,
  index: string,
  bounds: Bounds,
  options: FrameSelectionOptions,
): FrameElement {
  const padding = options.padding ?? DEFAULT_PADDING;
  if (!Number.isFinite(padding) || padding < 0) fail('padding is invalid');
  const x = bounds.x - padding;
  const y = bounds.y - padding - HEADER_HEIGHT;
  const w = Math.max(80, bounds.w + padding * 2);
  const h = Math.max(48, bounds.h + padding * 2 + HEADER_HEIGHT);
  if (![x, y, w, h, x + w, y + h].every(Number.isFinite)) fail('frame geometry is invalid');
  return {
    id,
    type: 'extension',
    extensionType: FRAME_ELEMENT_TYPE,
    position: { x, y },
    size: { w, h },
    layerId,
    index,
    version: 1,
    locked: false,
    dataVersion: 1,
    data: { title: options.title ?? 'Frame', color: options.color ?? '#64748b' },
  };
}

function unionBounds(elements: readonly CanvasElement[], registry: ElementRegistry): Bounds {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const element of elements) {
    const bounds = getElementVisualBounds(element, registry);
    if (!bounds || !finiteBounds(bounds)) fail('selection contains an unbounded element');
    left = Math.min(left, bounds.x);
    top = Math.min(top, bounds.y);
    right = Math.max(right, bounds.x + bounds.w);
    bottom = Math.max(bottom, bounds.y + bounds.h);
  }
  const result = { x: left, y: top, w: right - left, h: bottom - top };
  if (!finiteBounds(result)) fail('frame geometry is invalid');
  return result;
}

/** Builds a validated frame-selection operation without changing live state. */
export function planFrameSelection(
  ids: readonly string[],
  options: FrameSelectionOptions,
  frameId: string,
  store: ElementStore,
  registry: ElementRegistry,
  layers: LayerManager,
): FrameCommandPlan {
  const all = scene(store);
  const closure = roots(ids, store);
  requireRootInputs(ids, closure, store);
  requireIncoming(closure, registry, layers);
  if (store.getById(frameId)) fail('frame id already exists');
  const layerId = closure.roots[0]?.layerId;
  if (!layerId) fail('selection is empty');
  const selectedIds = new Set(closure.roots.map((element) => element.id));
  const rootOrder = sortedRoots(all, layerId);
  const lowest = rootOrder.find((element) => selectedIds.has(element.id));
  if (!lowest) fail('selection has no root order');
  if (rootOrder.some((element) => !selectedIds.has(element.id) && element.index === lowest.index)) {
    fail('frame order slot is ambiguous');
  }
  const childKeys = keysBetween(null, null, closure.roots.length, []);
  const add = frameEnvelope(
    frameId,
    layerId,
    lowest.index,
    unionBounds(closure.elements, registry),
    options,
  );
  return validatePlan(store, registry, {
    add,
    updates: closure.roots.map((element, index) => ({
      id: element.id,
      partial: { parentId: frameId, index: childKeys[index] },
    })),
  });
}

/** Builds a validated append-to-frame operation without changing live state. */
export function planAddToFrame(
  frameId: string,
  ids: readonly string[],
  store: ElementStore,
  registry: ElementRegistry,
  layers: LayerManager,
): FrameCommandPlan {
  const all = scene(store);
  const frame = store.getById(frameId);
  if (!isFrame(frame) || frame.parentId !== undefined || frame.locked)
    fail('target is not an eligible frame');
  requireLayer(frame.layerId, layers);
  const closure = roots(ids, store);
  requireRootInputs(ids, closure, store);
  requireIncoming(closure, registry, layers);
  if (closure.roots.some((element) => element.layerId !== frame.layerId))
    fail('selection spans layers');
  const children = sortedRoots(all, frame.layerId, frameId);
  const keys = keysBetween(
    children.at(-1)?.index ?? null,
    null,
    closure.roots.length,
    children.map((element) => element.index),
  );
  return validatePlan(store, registry, {
    updates: closure.roots.map((element, index) => ({
      id: element.id,
      partial: { parentId: frameId, index: keys[index] },
    })),
  });
}

function directChildren(
  frameId: string,
  ids: readonly string[],
  store: ElementStore,
): ReturnType<typeof getHierarchyClosure> {
  requireIds(ids, store);
  const closure = getHierarchyClosure(ids, store);
  const normalized = closure.roots;
  if (normalized.length === 0) fail('selection is empty');
  for (const element of normalized) {
    if (element.parentId !== frameId) fail('selection contains a non-member');
    if (element.locked) fail('selection contains a locked root');
  }
  return closure;
}

function nextRoot(all: readonly CanvasElement[], frame: FrameElement): CanvasElement | undefined {
  const roots = sortedRoots(all, frame.layerId);
  const at = roots.findIndex((element) => element.id === frame.id);
  return at < 0 ? undefined : roots[at + 1];
}

/** Builds a validated remove-from-frame operation without changing live state. */
export function planRemoveFromFrame(
  frameId: string,
  ids: readonly string[],
  store: ElementStore,
  registry: ElementRegistry,
  layers: LayerManager,
): FrameCommandPlan {
  const all = scene(store);
  const frame = store.getById(frameId);
  if (!isFrame(frame) || frame.parentId !== undefined || frame.locked)
    fail('target is not an eligible frame');
  requireLayer(frame.layerId, layers);
  const closure = directChildren(frameId, ids, store);
  const keys = keysBetween(
    frame.index,
    nextRoot(all, frame)?.index ?? null,
    closure.roots.length,
    sortedRoots(all, frame.layerId).map((element) => element.index),
  );
  return validatePlan(store, registry, {
    updates: closure.roots.map((element, index) => ({
      id: element.id,
      partial: { parentId: undefined, index: keys[index] },
    })),
  });
}

/** Builds a validated dissolve operation without changing live state. */
export function planDissolveFrame(
  frameId: string,
  store: ElementStore,
  registry: ElementRegistry,
  layers: LayerManager,
): FrameCommandPlan {
  const all = scene(store);
  const frame = store.getById(frameId);
  if (!isFrame(frame) || frame.parentId !== undefined || frame.locked)
    fail('target is not an eligible frame');
  requireLayer(frame.layerId, layers);
  const children = sortedRoots(all, frame.layerId, frameId);
  if (children.some((element) => element.locked)) fail('frame contains a locked child');
  const roots = sortedRoots(all, frame.layerId);
  const at = roots.findIndex((element) => element.id === frameId);
  if (at < 0) fail('frame has no root order');
  const keys =
    children.length === 0
      ? []
      : keysBetween(
          roots[at - 1]?.index ?? null,
          roots[at + 1]?.index ?? null,
          children.length,
          roots.filter((element) => element.id !== frameId).map((element) => element.index),
        );
  return validatePlan(store, registry, {
    updates: children.map((element, index) => ({
      id: element.id,
      partial: { parentId: undefined, index: keys[index] },
    })),
    removeId: frameId,
  });
}

/** Returns false instead of exposing planner validation failures to UI predicates. */
export function canFrameSelection(
  ids: readonly string[],
  store: ElementStore,
  registry: ElementRegistry,
  layers: LayerManager,
): boolean {
  try {
    let frameId = '__frame_preflight__';
    let suffix = 0;
    while (store.getById(frameId)) frameId = `__frame_preflight__${++suffix}`;
    planFrameSelection(ids, {}, frameId, store, registry, layers);
    return true;
  } catch {
    return false;
  }
}

/** Returns a common eligible parent frame for selection actions. */
export function removableFrameId(
  ids: readonly string[],
  store: ElementStore,
  registry: ElementRegistry,
  layers: LayerManager,
): string | undefined {
  try {
    requireIds(ids, store);
    const closure = getHierarchyClosure(ids, store);
    const parentId = closure.roots[0]?.parentId;
    if (!parentId || closure.roots.some((element) => element.parentId !== parentId))
      return undefined;
    planRemoveFromFrame(parentId, ids, store, registry, layers);
    return parentId;
  } catch {
    return undefined;
  }
}

/** Returns whether exactly one eligible frame is selected. */
export function canDissolveFrame(
  ids: readonly string[],
  store: ElementStore,
  registry: ElementRegistry,
  layers: LayerManager,
): boolean {
  if (ids.length !== 1) return false;
  try {
    planDissolveFrame(ids[0] ?? '', store, registry, layers);
    return true;
  } catch {
    return false;
  }
}
