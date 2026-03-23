import type { ElementStore } from '../elements/element-store';
import type { Camera } from '../canvas/camera';
import type { LayerManager } from '../layers/layer-manager';
import { exportState, parseState } from './state-serializer';
import type { CanvasState } from './state-serializer';

export interface AutoSaveOptions {
  key?: string;
  debounceMs?: number;
  layerManager?: LayerManager;
}

const DEFAULT_KEY = 'fieldnotes-autosave';
const DEFAULT_DEBOUNCE_MS = 1000;

export class AutoSave {
  private readonly key: string;
  private readonly debounceMs: number;
  private readonly layerManager?: LayerManager;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private unsubscribers: (() => void)[] = [];

  constructor(
    private readonly store: ElementStore,
    private readonly camera: Camera,
    options: AutoSaveOptions = {},
  ) {
    this.key = options.key ?? DEFAULT_KEY;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.layerManager = options.layerManager;
  }

  start(): void {
    const schedule = () => this.scheduleSave();

    this.unsubscribers = [
      this.store.on('add', schedule),
      this.store.on('remove', schedule),
      this.store.on('update', schedule),
      this.camera.onChange(schedule),
    ];
    if (this.layerManager) {
      this.unsubscribers.push(this.layerManager.on('change', schedule));
    }
  }

  stop(): void {
    this.cancelPending();
    this.unsubscribers.forEach((fn) => fn());
    this.unsubscribers = [];
  }

  load(): CanvasState | null {
    if (typeof localStorage === 'undefined') return null;

    const json = localStorage.getItem(this.key);
    if (!json) return null;

    try {
      return parseState(json);
    } catch {
      return null;
    }
  }

  clear(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(this.key);
  }

  private scheduleSave(): void {
    this.cancelPending();
    this.timerId = setTimeout(() => this.save(), this.debounceMs);
  }

  private cancelPending(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private save(): void {
    if (typeof localStorage === 'undefined') return;

    const layers = this.layerManager?.snapshot() ?? [];
    const state = exportState(this.store.snapshot(), this.camera, layers);
    localStorage.setItem(this.key, JSON.stringify(state));
  }
}
