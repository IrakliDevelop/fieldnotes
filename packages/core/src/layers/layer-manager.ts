import { EventBus } from '../core/event-bus';
import type { ElementStore } from '../elements/element-store';
import type { Layer } from './types';
import { createId } from '../elements/create-id';

interface LayerManagerEvents {
  change: null;
}

export class LayerManager {
  private layers = new Map<string, Layer>();
  private _activeLayerId: string;
  private bus = new EventBus<LayerManagerEvents>();

  constructor(private readonly store: ElementStore) {
    const defaultLayer: Layer = {
      id: createId('layer'),
      name: 'Layer 1',
      visible: true,
      locked: false,
      order: 0,
      opacity: 1.0,
    };
    this.layers.set(defaultLayer.id, defaultLayer);
    this._activeLayerId = defaultLayer.id;
    this.syncLayerOrder();
  }

  get activeLayer(): Layer {
    const layer = this.layers.get(this._activeLayerId);
    if (!layer) throw new Error('Active layer not found');
    return { ...layer };
  }

  get activeLayerId(): string {
    return this._activeLayerId;
  }

  getLayers(): Layer[] {
    return [...this.layers.values()].sort((a, b) => a.order - b.order).map((l) => ({ ...l }));
  }

  getLayer(id: string): Layer | undefined {
    const layer = this.layers.get(id);
    return layer ? { ...layer } : undefined;
  }

  isLayerVisible(id: string): boolean {
    return this.layers.get(id)?.visible ?? true;
  }

  isLayerLocked(id: string): boolean {
    return this.layers.get(id)?.locked ?? false;
  }

  createLayer(name?: string): Layer {
    const maxOrder = Math.max(...[...this.layers.values()].map((l) => l.order), -1);
    const autoName = name ?? `Layer ${this.layers.size + 1}`;
    const layer: Layer = {
      id: createId('layer'),
      name: autoName,
      visible: true,
      locked: false,
      order: maxOrder + 1,
      opacity: 1.0,
    };
    this.addLayerDirect(layer);
    return { ...layer };
  }

  removeLayer(id: string): void {
    if (this.layers.size <= 1) {
      throw new Error('Cannot remove the last layer');
    }
    if (this._activeLayerId === id) {
      const remaining = [...this.layers.values()]
        .filter((l) => l.id !== id)
        .sort((a, b) => b.order - a.order);
      const fallback = remaining[0];
      if (fallback) this._activeLayerId = fallback.id;
    }
    const elements = this.store.getAll().filter((el) => el.layerId === id);
    for (const el of elements) {
      this.store.update(el.id, { layerId: this._activeLayerId });
    }
    this.removeLayerDirect(id);
  }

  renameLayer(id: string, name: string): void {
    this.updateLayerDirect(id, { name });
  }

  reorderLayer(id: string, newOrder: number): void {
    if (!this.layers.has(id)) return;
    this.updateLayerDirect(id, { order: newOrder });
  }

  setLayerVisible(id: string, visible: boolean): boolean {
    if (!visible && id === this._activeLayerId) {
      const fallback = this.findFallbackLayer(id);
      if (!fallback) return false;
      this._activeLayerId = fallback.id;
    }
    this.updateLayerDirect(id, { visible });
    return true;
  }

  setLayerLocked(id: string, locked: boolean): boolean {
    if (locked && id === this._activeLayerId) {
      const fallback = this.findFallbackLayer(id);
      if (!fallback) return false;
      this._activeLayerId = fallback.id;
    }
    this.updateLayerDirect(id, { locked });
    return true;
  }

  setActiveLayer(id: string): void {
    if (!this.layers.has(id)) return;
    this._activeLayerId = id;
    this.bus.emit('change', null);
  }

  moveElementToLayer(elementId: string, layerId: string): void {
    if (!this.layers.has(layerId)) return;
    this.store.update(elementId, { layerId });
    this.bus.emit('change', null);
  }

  snapshot(): Layer[] {
    return this.getLayers();
  }

  loadSnapshot(layers: Layer[]): void {
    this.layers.clear();
    for (const layer of layers) {
      this.layers.set(layer.id, { ...layer });
    }
    const first = this.getLayers()[0];
    if (first) this._activeLayerId = first.id;
    this.syncLayerOrder();
    this.bus.emit('change', null);
  }

  on(event: 'change', callback: () => void): () => void {
    return this.bus.on(event, callback);
  }

  addLayerDirect(layer: Layer): void {
    this.layers.set(layer.id, { ...layer });
    this.syncLayerOrder();
    this.bus.emit('change', null);
  }

  removeLayerDirect(id: string): void {
    this.layers.delete(id);
    this.syncLayerOrder();
    this.bus.emit('change', null);
  }

  updateLayerDirect(id: string, props: Omit<Partial<Layer>, 'id'>): void {
    const layer = this.layers.get(id);
    if (!layer) return;
    Object.assign(layer, props);
    if ('order' in props) this.syncLayerOrder();
    this.bus.emit('change', null);
  }

  private syncLayerOrder(): void {
    const order = new Map<string, number>();
    for (const layer of this.layers.values()) {
      order.set(layer.id, layer.order);
    }
    this.store.setLayerOrder(order);
  }

  private findFallbackLayer(excludeId: string): Layer | undefined {
    return [...this.layers.values()]
      .filter((l) => l.id !== excludeId && l.visible && !l.locked)
      .sort((a, b) => b.order - a.order)[0];
  }
}
