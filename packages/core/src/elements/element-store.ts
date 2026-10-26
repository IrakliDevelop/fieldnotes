import { EventBus, isExternalChange } from '../core/event-bus';
import { generateKeyBetween } from '../core/fractional-index';
import type { Bounds, Point } from '../core/types';
import { Quadtree } from '../core/quadtree';
import { getElementBounds, getElementVisualBounds, transferStrokeBounds } from './element-bounds';
import { getArrowControlPoint } from './arrow-geometry';
import { sanitizeNoteHtml } from './note-sanitizer';
import { computeStrokeSegments, transferStrokeRenderData } from './stroke-cache';
import type { CanvasElement, ElementType } from './types';
import type { ElementRegistry } from './element-registry';
import { getDefaultElementRegistry } from './default-registry';
import { ElementHierarchy, validateHierarchy } from './element-hierarchy';

function sanitizeRichText(element: CanvasElement): CanvasElement {
  if (element.type !== 'note' && element.type !== 'text') return element;
  const text = sanitizeNoteHtml(element.text);
  return text === element.text ? element : { ...element, text };
}

// Elements entering the store hold current data, so saves and sync never migrate them again.
function stampDataVersion(element: CanvasElement, registry: ElementRegistry): CanvasElement {
  if (element.type !== 'extension' || element.dataVersion !== undefined) return element;
  const dataVersion = registry.getAdapter(element.extensionType)?.dataVersion;
  return dataVersion === undefined ? element : { ...element, dataVersion };
}

export interface ElementUpdateEvent {
  previous: CanvasElement;
  current: CanvasElement;
}

export interface ElementChangeMeta {
  /**
   * Identifies what caused the change. `undefined` or `'local'` = a local change (recorded to undo
   * history and observed as local). Any other value (e.g. `'remote'`) marks an externally-applied
   * change: it is NOT recorded to undo history, and is tagged so observers can avoid re-broadcasting it.
   * `'host'` is reserved for host-owned elements driven by the embedding application; like `'remote'`
   * it is external, so it neither creates an undo step nor is re-broadcast.
   */
  origin?: string;
}

interface ElementStoreEvents {
  add: CanvasElement;
  remove: CanvasElement;
  update: ElementUpdateEvent;
  clear: null;
  /** Atomic replacement completed; inspect the store for its final contents. */
  batch: null;
}

export class ElementStore {
  private elements = new Map<string, CanvasElement>();
  private bus = new EventBus<ElementStoreEvents>();
  private layerOrderMap = new Map<string, number>();
  private spatialIndex = new Quadtree({ x: -100000, y: -100000, w: 200000, h: 200000 });
  private hierarchy: ElementHierarchy | null = null;
  private sceneCache: CanvasElement[] | null = null;
  private _versions = new Map<string, number>();
  private registry: ElementRegistry;

  constructor(elementRegistry: ElementRegistry = getDefaultElementRegistry()) {
    this.registry = elementRegistry;
  }

  /** The registry that resolves bounds for this store's elements. */
  get elementRegistry(): ElementRegistry {
    return this.registry;
  }

  setElementRegistry(elementRegistry: ElementRegistry): void {
    if (elementRegistry === this.registry) return;
    this.registry = elementRegistry;
    this.resetHierarchy();
    this.spatialIndex.clear();
    for (const element of this.elements.values()) {
      const bounds = this.indexBounds(element);
      if (bounds) this.spatialIndex.insert(element.id, bounds);
    }
  }

  get count(): number {
    return this.elements.size;
  }

  /** DOM refresh counter; not element.version. */
  getVersion(id: string): number {
    return this._versions.get(id) ?? -1;
  }

  setLayerOrder(order: Map<string, number>): void {
    this.layerOrderMap = new Map(order);
    this.resetHierarchy();
  }

  getAll(): CanvasElement[] {
    this.sceneCache ??= [...this.getHierarchy().scene];
    return this.sceneCache;
  }

  private getHierarchy(): ElementHierarchy {
    this.hierarchy ??= new ElementHierarchy(this.elements, this.registry, this.layerOrderMap);
    return this.hierarchy;
  }

  private strict(meta: ElementChangeMeta | undefined): boolean {
    return meta?.origin !== 'remote';
  }

  private validateCandidate(candidate: Map<string, CanvasElement>, meta?: ElementChangeMeta): void {
    if (this.strict(meta)) validateHierarchy(candidate, this.registry);
  }

  private resetHierarchy(): void {
    this.hierarchy = null;
    this.sceneCache = null;
  }

  private topIndex(layerId: string): string | null {
    let top: string | null = null;
    for (const el of this.elements.values()) {
      if (el.layerId === layerId && (top === null || el.index > top)) top = el.index;
    }
    return top;
  }

  getById(id: string): CanvasElement | undefined {
    return this.elements.get(id);
  }

  getElementsByType<T extends ElementType>(type: T): Extract<CanvasElement, { type: T }>[] {
    return this.getAll().filter(
      (el): el is Extract<CanvasElement, { type: T }> => el.type === type,
    );
  }

  getChildren(id: string): readonly CanvasElement[] {
    return [...this.getHierarchy().getChildren(id)];
  }

  getDescendants(id: string): readonly CanvasElement[] {
    return [...this.getHierarchy().getDescendants(id)];
  }

  private indexBounds(element: CanvasElement): Bounds | null {
    const bounds = getElementBounds(element, this.registry);
    if (!bounds) return null;
    const visualBounds = getElementVisualBounds(element, this.registry);
    if (!visualBounds) return bounds;
    const x = Math.min(bounds.x, visualBounds.x);
    const y = Math.min(bounds.y, visualBounds.y);
    const right = Math.max(bounds.x + bounds.w, visualBounds.x + visualBounds.w);
    const bottom = Math.max(bounds.y + bounds.h, visualBounds.y + visualBounds.h);
    return {
      x,
      y,
      w: right - x,
      h: bottom - y,
    };
  }

  add(element: CanvasElement, meta?: ElementChangeMeta): void {
    element = stampDataVersion(sanitizeRichText(element), this.registry);
    if (element.index === '') {
      element = { ...element, index: generateKeyBetween(this.topIndex(element.layerId), null) };
    }
    const candidate = new Map(this.elements);
    candidate.set(element.id, element);
    this.validateCandidate(candidate, meta);
    this.resetHierarchy();
    this._versions.set(element.id, 0);
    this.elements.set(element.id, element);
    const bounds = this.indexBounds(element);
    if (bounds) this.spatialIndex.insert(element.id, bounds);
    this.bus.emit('add', element, meta);
  }

  update(id: string, partial: Partial<CanvasElement>, meta?: ElementChangeMeta): void {
    const existing = this.elements.get(id);
    if (!existing) return;
    const updated = this.prepareUpdate(existing, partial, meta);
    const candidate = new Map(this.elements);
    candidate.set(id, updated);
    this.validateCandidate(candidate, meta);
    this.installUpdate(existing, updated);
    this.bus.emit('update', { previous: existing, current: updated }, meta);
  }

  /** Applies several element patches atomically. */
  updateMany(
    updates: readonly { id: string; partial: Partial<CanvasElement> }[],
    meta?: ElementChangeMeta,
  ): void {
    const ids = new Set<string>();
    for (const update of updates) {
      if (ids.has(update.id)) throw new Error(`Duplicate update id "${update.id}"`);
      ids.add(update.id);
    }
    const prepared: { existing: CanvasElement; updated: CanvasElement }[] = [];
    const candidate = new Map(this.elements);
    for (const update of updates) {
      const existing = this.elements.get(update.id);
      if (!existing) continue;
      const updated = this.prepareUpdate(existing, update.partial, meta);
      candidate.set(update.id, updated);
      prepared.push({ existing, updated });
    }
    if (prepared.length === 0) return;
    this.validateCandidate(candidate, meta);
    const structural = prepared.some(({ existing, updated }) =>
      this.isStructural(existing, updated),
    );
    for (const item of prepared) this.installUpdate(item.existing, item.updated, structural);
    if (structural) this.resetHierarchy();
    if (structural) this.getHierarchy();
    for (const item of prepared)
      this.bus.emit('update', { previous: item.existing, current: item.updated }, meta);
  }

  private prepareUpdate(
    existing: CanvasElement,
    partial: Partial<CanvasElement>,
    meta?: ElementChangeMeta,
  ): CanvasElement {
    // Shallow spread preserves the points array identity when `partial` omits points.
    const updated = {
      ...existing,
      ...partial,
      id: existing.id,
      type: existing.type,
    } as CanvasElement;

    // Local edits (including undo/redo) always move forward; remote ones carry the accepted version.
    if (!isExternalChange(meta)) {
      updated.version = existing.version + 1;
      delete updated.editor;
    } else if (!('version' in partial)) {
      updated.version = existing.version;
      if (existing.editor === undefined) delete updated.editor;
      else updated.editor = existing.editor;
    } else if (partial.editor === undefined) {
      delete updated.editor;
    }

    if (updated.type === 'stroke' && existing.type === 'stroke') {
      transferStrokeRenderData(existing, updated);
      transferStrokeBounds(existing, updated);
    }

    if (updated.type === 'arrow') {
      const arrow = updated;
      arrow.cachedControlPoint = getArrowControlPoint(arrow.from, arrow.to, arrow.bend);
    }

    if ((updated.type === 'note' || updated.type === 'text') && 'text' in partial) {
      updated.text = sanitizeNoteHtml(updated.text);
    }

    return updated;
  }

  private isStructural(existing: CanvasElement, updated: CanvasElement): boolean {
    return (
      existing.parentId !== updated.parentId ||
      existing.layerId !== updated.layerId ||
      existing.index !== updated.index ||
      (existing.type === 'extension' &&
        updated.type === 'extension' &&
        existing.extensionType !== updated.extensionType)
    );
  }

  private installUpdate(
    existing: CanvasElement,
    updated: CanvasElement,
    retainHierarchy = false,
  ): void {
    this._versions.set(existing.id, (this._versions.get(existing.id) ?? 0) + 1);
    this.elements.set(existing.id, updated);
    const structural = this.isStructural(existing, updated);
    if (structural && !retainHierarchy) this.resetHierarchy();
    else {
      this.hierarchy?.replace(existing, updated);
      this.sceneCache =
        this.sceneCache?.map((element) => (element === existing ? updated : element)) ?? null;
    }

    const newBounds = this.indexBounds(updated);
    if (newBounds) {
      this.spatialIndex.update(existing.id, newBounds);
    } else {
      this.spatialIndex.remove(existing.id);
    }
  }

  remove(id: string, meta?: ElementChangeMeta): void {
    const element = this.elements.get(id);
    if (!element) return;
    const candidate = new Map(this.elements);
    candidate.delete(id);
    this.validateCandidate(candidate, meta);
    this.resetHierarchy();
    this._versions.delete(id);

    this.elements.delete(id);
    this.spatialIndex.remove(id);
    this.bus.emit('remove', element, meta);
  }

  clear(meta?: ElementChangeMeta): void {
    this.resetHierarchy();
    this._versions.clear();
    this.elements.clear();
    this.spatialIndex.clear();
    this.bus.emit('clear', null, meta);
  }

  snapshot(): CanvasElement[] {
    return this.getAll().map((el) => ({ ...el }));
  }

  loadSnapshot(elements: CanvasElement[], meta?: ElementChangeMeta): void {
    const tops = new Map<string, string>();
    for (const el of elements) {
      const top = tops.get(el.layerId);
      if (el.index !== '' && (top === undefined || el.index > top)) tops.set(el.layerId, el.index);
    }
    const sanitizedElements = elements.map((el) => {
      const element = stampDataVersion(sanitizeRichText(el), this.registry);
      if (element.index !== '') return element;
      const index = generateKeyBetween(tops.get(element.layerId) ?? null, null);
      tops.set(element.layerId, index);
      return { ...element, index };
    });
    const candidate = new Map(sanitizedElements.map((element) => [element.id, element]));
    this.validateCandidate(candidate, meta);
    this.resetHierarchy();
    this._versions.clear();
    this.elements.clear();
    this.spatialIndex.clear();
    for (const el of sanitizedElements) {
      this.elements.set(el.id, el);
      this._versions.set(el.id, 0);
      const bounds = this.indexBounds(el);
      if (bounds) this.spatialIndex.insert(el.id, bounds);
      if (el.type === 'stroke') {
        computeStrokeSegments(el);
      }
      if (el.type === 'arrow' && el.bend !== 0 && !el.cachedControlPoint) {
        el.cachedControlPoint = getArrowControlPoint(el.from, el.to, el.bend);
      }
    }
    this.bus.emit('clear', null, meta);
    for (const el of sanitizedElements) {
      this.bus.emit('add', el, meta);
    }
  }

  bringToFront(id: string): void {
    const siblings = this.layerSiblings(id);
    const top = siblings.at(-1);
    if (!top || top.id === id) return;
    this.reorder(id, top.index, null);
  }

  sendToBack(id: string): void {
    const bottom = this.layerSiblings(id)[0];
    if (!bottom || bottom.id === id) return;
    this.reorder(id, null, bottom.index);
  }

  bringForward(id: string): void {
    const siblings = this.layerSiblings(id);
    const next = siblings[siblings.findIndex((e) => e.id === id) + 1];
    if (!next) return;
    const upper = siblings.find((e) => e.index > next.index);
    this.reorder(id, next.index, upper?.index ?? null);
  }

  sendBackward(id: string): void {
    const siblings = this.layerSiblings(id);
    const prev = siblings[siblings.findIndex((e) => e.id === id) - 1];
    if (!prev) return;
    const lower = siblings.filter((e) => e.index < prev.index).at(-1);
    this.reorder(id, lower?.index ?? null, prev.index);
  }

  // Sorted elements sharing the layer of `id`; empty when `id` is unknown.
  private layerSiblings(id: string): CanvasElement[] {
    const el = this.elements.get(id);
    return el
      ? this.getAll().filter((e) => e.layerId === el.layerId && e.parentId === el.parentId)
      : [];
  }

  private reorder(id: string, below: string | null, above: string | null): void {
    let index: string;
    try {
      index = generateKeyBetween(below, above);
    } catch {
      return; // no key fits (128-character limit): leave the order unchanged
    }
    this.update(id, { index });
  }

  queryRect(rect: Bounds): CanvasElement[] {
    const ids = this.spatialIndex.query(rect);
    const elements: CanvasElement[] = [];
    for (const id of ids) {
      const el = this.elements.get(id);
      if (el && this.getHierarchy().rank(id) !== undefined) elements.push(el);
    }
    return elements.sort(
      (a, b) => (this.getHierarchy().rank(a.id) ?? 0) - (this.getHierarchy().rank(b.id) ?? 0),
    );
  }

  queryPoint(point: Point): CanvasElement[] {
    return this.queryRect({ x: point.x, y: point.y, w: 0, h: 0 });
  }

  on<K extends keyof ElementStoreEvents>(
    event: K,
    listener: (data: ElementStoreEvents[K], meta: ElementChangeMeta) => void,
  ): () => void {
    return this.bus.on(event, listener);
  }

  onChange(listener: () => void): () => void {
    const unsubs = [
      this.bus.on('add', listener),
      this.bus.on('remove', listener),
      this.bus.on('update', listener),
      this.bus.on('clear', listener),
      this.bus.on('batch', listener),
    ];
    return () => unsubs.forEach((fn) => fn());
  }

  suspendNotifications(): { resume(): void; discard(): void } {
    return this.bus.suspendNotifications(() => ({ event: 'batch', data: null }));
  }
}
