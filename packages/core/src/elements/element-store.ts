import { EventBus } from '../core/event-bus';
import type { Bounds, Point } from '../core/types';
import { Quadtree } from '../core/quadtree';
import { getElementBounds } from './element-bounds';
import { getArrowControlPoint } from './arrow-geometry';
import { sanitizeNoteHtml } from './note-sanitizer';
import type { ArrowElement, CanvasElement, ElementType, NoteElement } from './types';

export interface ElementUpdateEvent {
  previous: CanvasElement;
  current: CanvasElement;
}

interface ElementStoreEvents {
  add: CanvasElement;
  remove: CanvasElement;
  update: ElementUpdateEvent;
  clear: null;
}

export class ElementStore {
  private elements = new Map<string, CanvasElement>();
  private bus = new EventBus<ElementStoreEvents>();
  private layerOrderMap = new Map<string, number>();
  private spatialIndex = new Quadtree({ x: -100000, y: -100000, w: 200000, h: 200000 });
  private sortedCache: CanvasElement[] | null = null;

  get count(): number {
    return this.elements.size;
  }

  setLayerOrder(order: Map<string, number>): void {
    this.layerOrderMap = new Map(order);
    this.sortedCache = null;
  }

  getAll(): CanvasElement[] {
    if (this.sortedCache) return this.sortedCache;
    this.sortedCache = [...this.elements.values()].sort((a, b) => {
      const layerA = this.layerOrderMap.get(a.layerId) ?? 0;
      const layerB = this.layerOrderMap.get(b.layerId) ?? 0;
      if (layerA !== layerB) return layerA - layerB;
      return a.zIndex - b.zIndex;
    });
    return this.sortedCache;
  }

  getById(id: string): CanvasElement | undefined {
    return this.elements.get(id);
  }

  getElementsByType<T extends ElementType>(type: T): Extract<CanvasElement, { type: T }>[] {
    return this.getAll().filter(
      (el): el is Extract<CanvasElement, { type: T }> => el.type === type,
    );
  }

  add(element: CanvasElement): void {
    this.sortedCache = null;
    this.elements.set(element.id, element);
    const bounds = getElementBounds(element);
    if (bounds) this.spatialIndex.insert(element.id, bounds);
    this.bus.emit('add', element);
  }

  update(id: string, partial: Partial<CanvasElement>): void {
    const existing = this.elements.get(id);
    if (!existing) return;
    this.sortedCache = null;

    const updated = { ...existing, ...partial, id: existing.id, type: existing.type };

    if (updated.type === 'arrow') {
      const arrow = updated as ArrowElement;
      arrow.cachedControlPoint = getArrowControlPoint(arrow.from, arrow.to, arrow.bend);
    }

    if (updated.type === 'note' && 'text' in partial) {
      (updated as NoteElement).text = sanitizeNoteHtml((updated as NoteElement).text);
    }

    this.elements.set(id, updated as CanvasElement);

    const newBounds = getElementBounds(updated as CanvasElement);
    if (newBounds) {
      this.spatialIndex.update(id, newBounds);
    }

    this.bus.emit('update', { previous: existing, current: updated as CanvasElement });
  }

  remove(id: string): void {
    const element = this.elements.get(id);
    if (!element) return;
    this.sortedCache = null;

    this.elements.delete(id);
    this.spatialIndex.remove(id);
    this.bus.emit('remove', element);
  }

  clear(): void {
    this.sortedCache = null;
    this.elements.clear();
    this.spatialIndex.clear();
    this.bus.emit('clear', null);
  }

  snapshot(): CanvasElement[] {
    return this.getAll().map((el) => ({ ...el }));
  }

  loadSnapshot(elements: CanvasElement[]): void {
    this.sortedCache = null;
    this.elements.clear();
    this.spatialIndex.clear();
    for (const el of elements) {
      this.elements.set(el.id, el);
      const bounds = getElementBounds(el);
      if (bounds) this.spatialIndex.insert(el.id, bounds);
    }
    this.bus.emit('clear', null);
    for (const el of elements) {
      this.bus.emit('add', el);
    }
  }

  queryRect(rect: Bounds): CanvasElement[] {
    const ids = this.spatialIndex.query(rect);
    const elements: CanvasElement[] = [];
    for (const id of ids) {
      const el = this.elements.get(id);
      if (el) elements.push(el);
    }
    return elements.sort((a, b) => {
      const layerA = this.layerOrderMap.get(a.layerId) ?? 0;
      const layerB = this.layerOrderMap.get(b.layerId) ?? 0;
      if (layerA !== layerB) return layerA - layerB;
      return a.zIndex - b.zIndex;
    });
  }

  queryPoint(point: Point): CanvasElement[] {
    return this.queryRect({ x: point.x, y: point.y, w: 0, h: 0 });
  }

  on<K extends keyof ElementStoreEvents>(
    event: K,
    listener: (data: ElementStoreEvents[K]) => void,
  ): () => void {
    return this.bus.on(event, listener);
  }

  onChange(listener: () => void): () => void {
    const unsubs = [
      this.bus.on('add', listener),
      this.bus.on('remove', listener),
      this.bus.on('update', listener),
      this.bus.on('clear', listener),
    ];
    return () => unsubs.forEach((fn) => fn());
  }
}
