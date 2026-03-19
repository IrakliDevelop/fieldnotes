import { EventBus } from '../core/event-bus';
import type { CanvasElement, ElementType } from './types';

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

  get count(): number {
    return this.elements.size;
  }

  getAll(): CanvasElement[] {
    return [...this.elements.values()].sort((a, b) => a.zIndex - b.zIndex);
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
    this.elements.set(element.id, element);
    this.bus.emit('add', element);
  }

  update(id: string, partial: Partial<CanvasElement>): void {
    const existing = this.elements.get(id);
    if (!existing) return;

    const updated = { ...existing, ...partial, id: existing.id, type: existing.type };
    this.elements.set(id, updated as CanvasElement);
    this.bus.emit('update', { previous: existing, current: updated as CanvasElement });
  }

  remove(id: string): void {
    const element = this.elements.get(id);
    if (!element) return;

    this.elements.delete(id);
    this.bus.emit('remove', element);
  }

  clear(): void {
    this.elements.clear();
    this.bus.emit('clear', null);
  }

  snapshot(): CanvasElement[] {
    return this.getAll().map((el) => ({ ...el }));
  }

  loadSnapshot(elements: CanvasElement[]): void {
    this.elements.clear();
    for (const el of elements) {
      this.elements.set(el.id, el);
    }
  }

  on<K extends keyof ElementStoreEvents>(
    event: K,
    listener: (data: ElementStoreEvents[K]) => void,
  ): () => void {
    return this.bus.on(event, listener);
  }
}
