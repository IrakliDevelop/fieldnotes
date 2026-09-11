import type { ElementStore } from '../elements/element-store';
import type { Camera } from '../canvas/camera';
import type { LayerManager } from '../layers/layer-manager';
import { exportState, parseState } from './state-serializer';
import type { CanvasState } from './state-serializer';
import { LocalStorageAdapter } from './storage/local-storage-adapter';
import type { StorageAdapter } from './storage/storage-adapter';
import type { ElementRegistry } from '../elements/element-registry';
import type { PluginStateManager } from './plugin-state-manager';

export interface AutoSaveOptions {
  key?: string;
  debounceMs?: number;
  layerManager?: LayerManager;
  adapter?: StorageAdapter;
  onError?: (error: Error) => void;
  elementRegistry?: ElementRegistry;
  pluginStateManager?: PluginStateManager;
  changeEmitters?: { onChange(listener: () => void): () => void }[];
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
  private readonly elementRegistry?: ElementRegistry;
  private readonly pluginStateManager?: PluginStateManager;
  private readonly changeEmitters?: { onChange(listener: () => void): () => void }[];
  private saving = false;
  /** Set when the saved data was unreadable; blocks saves so it is not clobbered. */
  private loadFailed = false;
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
    this.elementRegistry = options.elementRegistry;
    this.pluginStateManager = options.pluginStateManager;
    this.changeEmitters = options.changeEmitters;
  }

  start(): void {
    const schedule = () => this.scheduleSave();

    this.unsubscribers = [
      this.store.on('add', schedule),
      this.store.on('remove', schedule),
      this.store.on('update', schedule),
      this.store.on('batch', schedule),
      this.camera.onChange(schedule),
    ];
    if (this.layerManager) {
      this.unsubscribers.push(this.layerManager.on('change', schedule));
    }
    for (const emitter of this.changeEmitters ?? []) {
      this.unsubscribers.push(emitter.onChange(schedule));
    }
  }

  stop(): void {
    this.cancelPending();
    this.unsubscribers.forEach((fn) => fn());
    this.unsubscribers = [];
  }

  /**
   * Loads the saved state. Returns `null` when nothing is saved OR when the
   * saved data cannot be read (corrupt, or written by a newer version). In the
   * latter case the error is reported through `onError` and subsequent saves
   * are refused until `clear()` or a later successful `load()`, so a newer
   * file is never silently overwritten by an older build.
   */
  async load(): Promise<CanvasState | null> {
    try {
      const json = await this.adapter.load(this.key);
      if (!json) {
        this.loadFailed = false;
        return null;
      }
      const state = parseState(json, this.elementRegistry);
      this.loadFailed = false;
      return state;
    } catch (e) {
      this.loadFailed = true;
      this.onError?.(
        new Error(
          `AutoSave: saved state at "${this.key}" could not be loaded and will not be overwritten: ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      );
      return null;
    }
  }

  async clear(): Promise<void> {
    await this.adapter.clear(this.key);
    this.loadFailed = false;
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
    if (this.loadFailed) return;
    if (this.saving) {
      this.pendingSave = true;
      return;
    }
    this.saving = true;
    try {
      const layers = this.layerManager?.snapshot() ?? [];
      const extensions = this.pluginStateManager?.exportState();
      const state = exportState(this.store.snapshot(), this.camera, layers, undefined, extensions);
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
