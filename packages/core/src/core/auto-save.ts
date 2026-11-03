import type { ElementStore } from '../elements/element-store';
import type { Camera } from '../canvas/camera';
import type { LayerManager } from '../layers/layer-manager';
import { exportState, parseState } from './state-serializer';
import type { CanvasState } from './state-serializer';
import { LocalStorageAdapter } from './storage/local-storage-adapter';
import type { StorageAdapter } from './storage/storage-adapter';
import type { ElementRegistry } from '../elements/element-registry';
import type { PluginStateManager } from './plugin-state-manager';
import { reportFailure } from './report-failure';

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

// Writes still in flight per storage target and key, so a remount on the same key loads after them.
// Every default LocalStorageAdapter writes to the same localStorage, so they share one target.
const pendingWrites = new WeakMap<object, Map<string, Promise<void>>>();
const LOCAL_STORAGE_TARGET = {};

function writesFor(target: object): Map<string, Promise<void>> {
  let writes = pendingWrites.get(target);
  if (!writes) {
    writes = new Map();
    pendingWrites.set(target, writes);
  }
  return writes;
}

export class AutoSave {
  private readonly key: string;
  private readonly debounceMs: number;
  private readonly layerManager?: LayerManager;
  private readonly adapter: StorageAdapter;
  private readonly target: object;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private unsubscribers: (() => void)[] = [];
  private readonly onError?: (error: Error) => void;
  private readonly explicitRegistry?: ElementRegistry;
  private readonly pluginStateManager?: PluginStateManager;
  private readonly changeEmitters?: { onChange(listener: () => void): () => void }[];
  private saving = false;
  private writeChain: Promise<void> | null = null;
  /** Set when the saved data was unreadable; blocks saves so it is not clobbered. */
  private loadFailed = false;
  private queuedJson: string | null = null;

  constructor(
    private readonly store: ElementStore,
    private readonly camera: Camera,
    options: AutoSaveOptions = {},
  ) {
    this.key = options.key ?? DEFAULT_KEY;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.layerManager = options.layerManager;
    this.adapter = options.adapter ?? new LocalStorageAdapter();
    this.target = options.adapter ?? LOCAL_STORAGE_TARGET;
    this.onError = options.onError;
    this.explicitRegistry = options.elementRegistry;
    this.pluginStateManager = options.pluginStateManager;
    this.changeEmitters = options.changeEmitters;
  }

  // Read per call so a later store.setElementRegistry applies to load and save.
  private get elementRegistry(): ElementRegistry {
    return this.explicitRegistry ?? this.store.elementRegistry;
  }

  start(): void {
    const schedule = () => this.scheduleSave();

    this.unsubscribers = [
      this.store.on('add', schedule),
      this.store.on('remove', schedule),
      this.store.on('update', schedule),
      this.store.on('batch', schedule),
      this.store.on('clear', schedule),
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

  /** Writes any pending change now; resolves when every queued write has settled. */
  async flush(): Promise<void> {
    if (this.timerId !== null) {
      this.cancelPending();
      await this.save();
    }
    await this.writeChain;
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
      await pendingWrites.get(this.target)?.get(this.key);
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
      this.notifyError(
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
    this.timerId = setTimeout(() => {
      this.timerId = null;
      void this.save();
    }, this.debounceMs);
  }

  private cancelPending(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private async save(): Promise<void> {
    if (this.loadFailed) return;
    try {
      const layers = this.layerManager?.snapshot() ?? [];
      const extensions = this.pluginStateManager?.exportState();
      const state = exportState(
        this.store.snapshot(),
        this.camera,
        layers,
        this.layerManager?.activeLayerId,
        extensions,
        this.elementRegistry,
      );
      const json = JSON.stringify(state);
      if (this.saving) {
        this.queuedJson = json;
        await this.writeChain;
        return;
      }
      this.saving = true;
      const chain = this.write(json);
      this.writeChain = chain;
      const writes = writesFor(this.target);
      writes.set(this.key, chain);
      void chain.finally(() => {
        if (writes.get(this.key) === chain) writes.delete(this.key);
      });
      await chain;
    } catch (e) {
      this.notifyError(e);
    }
  }

  private async write(json: string): Promise<void> {
    let next: string | null = json;
    try {
      while (next !== null) {
        try {
          await this.adapter.save(this.key, next);
        } catch (e) {
          this.notifyError(e);
        }
        next = this.queuedJson;
        this.queuedJson = null;
      }
    } finally {
      this.saving = false;
      this.writeChain = null;
    }
  }

  private notifyError(error: unknown): void {
    if (!this.onError) return;
    const normalized = error instanceof Error ? error : new Error(String(error));
    try {
      this.onError(normalized);
    } catch (callbackError) {
      reportFailure(callbackError, 'autosave onError failed');
    }
  }
}
