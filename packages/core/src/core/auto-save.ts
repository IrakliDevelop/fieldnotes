import type { ElementStore } from '../elements/element-store';
import type { Camera } from '../canvas/camera';
import type { LayerManager } from '../layers/layer-manager';
import { exportState, parseState } from './state-serializer';
import type { CanvasState } from './state-serializer';
import { LocalStorageAdapter } from './storage/local-storage-adapter';
import type { StorageAdapter } from './storage/storage-adapter';

export interface AutoSaveOptions {
  key?: string;
  debounceMs?: number;
  layerManager?: LayerManager;
  adapter?: StorageAdapter;
  onError?: (error: Error) => void;
}

const DEFAULT_KEY = 'fieldnotes-autosave';
const DEFAULT_DEBOUNCE_MS = 1000;

export class AutoSave {
  private readonly key: string;
  private readonly debounceMs: number;
  private readonly layerManager?: LayerManager;
  private readonly adapter: StorageAdapter;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private unsubscribers: (() => void)[] = [];
  private readonly onError?: (error: Error) => void;
  private saving = false;
  private pendingSave = false;

  constructor(
    private readonly store: ElementStore,
    private readonly camera: Camera,
    options: AutoSaveOptions = {},
  ) {
    this.key = options.key ?? DEFAULT_KEY;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.layerManager = options.layerManager;
    this.adapter = options.adapter ?? new LocalStorageAdapter();
    this.onError = options.onError;
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

  async load(): Promise<CanvasState | null> {
    const json = await this.adapter.load(this.key);
    if (!json) return null;

    try {
      return parseState(json);
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    await this.adapter.clear(this.key);
  }

  private scheduleSave(): void {
    this.cancelPending();
    this.timerId = setTimeout(() => void this.save(), this.debounceMs);
  }

  private cancelPending(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private async save(): Promise<void> {
    if (this.saving) {
      this.pendingSave = true;
      return;
    }
    this.saving = true;
    try {
      const layers = this.layerManager?.snapshot() ?? [];
      const state = exportState(this.store.snapshot(), this.camera, layers);
      await this.adapter.save(this.key, JSON.stringify(state));
    } catch (e) {
      this.onError?.(e instanceof Error ? e : new Error(String(e)));
    } finally {
      this.saving = false;
      if (this.pendingSave) {
        this.pendingSave = false;
        void this.save();
      }
    }
  }
}
