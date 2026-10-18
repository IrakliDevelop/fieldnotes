import type { Camera } from './camera';
import { reportFailure } from '../core/report-failure';

export type ViewportSlot = 'afterSceneBeforeOverlay' | 'afterOverlay' | 'afterToolOverlay';

const SLOT_ORDER: Record<ViewportSlot, number> = {
  afterSceneBeforeOverlay: 0,
  afterOverlay: 1,
  afterToolOverlay: 2,
};

export interface HookRegistrationOptions {
  slot?: ViewportSlot;
  priority?: number;
  required?: boolean;
  satisfies?: readonly string[];
  /**
   * Runtime visibility predicate. Disabled hooks keep their capabilities for construction-time
   * validation but do not satisfy them at render time.
   */
  enabled?: () => boolean;
}

interface InternalEntry<T> {
  hooks: Partial<T>;
  slot: ViewportSlot;
  priority: number;
  required: boolean;
  satisfies: string[];
  enabled?: () => boolean;
  insertionOrder: number;
  quarantined: boolean;
}

type HookArgs<F> = F extends (...args: infer A) => unknown ? A : never;

const NONE: readonly string[] = [];

export class TypedHookRegistry<T extends Record<string, unknown>> {
  private readonly entries: InternalEntry<T>[] = [];
  private readonly capabilityCounts = new Map<string, number>();
  private requiredCapabilities: readonly string[] = NONE;
  private nextId = 0;

  register(hooks: Partial<T>, options: HookRegistrationOptions = {}): () => void {
    const entry: InternalEntry<T> = {
      hooks,
      slot: options.slot ?? 'afterSceneBeforeOverlay',
      priority: options.priority ?? 0,
      required: options.required ?? false,
      satisfies: [...(options.satisfies ?? [])],
      enabled: options.enabled,
      insertionOrder: this.nextId++,
      quarantined: false,
    };

    this.entries.push(entry);

    for (const cap of entry.satisfies) {
      this.capabilityCounts.set(cap, (this.capabilityCounts.get(cap) ?? 0) + 1);
    }

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const idx = this.entries.indexOf(entry);
      if (idx >= 0) this.entries.splice(idx, 1);
      for (const cap of entry.satisfies) {
        const count = (this.capabilityCounts.get(cap) ?? 0) - 1;
        if (count <= 0) {
          this.capabilityCounts.delete(cap);
        } else {
          this.capabilityCounts.set(cap, count);
        }
      }
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic hook dispatcher; concrete signatures are enforced at register time
  *iterate(hookName: keyof T & string): Generator<(...args: any[]) => void> {
    for (const entry of this.sortedEntries()) {
      if (!this.isLive(entry)) continue;
      const fn = entry.hooks[hookName];
      if (typeof fn === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        yield fn as (...args: any[]) => void;
      }
    }
  }

  /**
   * Runs each live hook in order; a throwing hook is quarantined and reported once.
   * Returns true when this call quarantined a hook.
   */
  call<K extends keyof T & string>(hookName: K, ...args: HookArgs<T[K]>): boolean {
    let failed = false;
    for (const entry of this.sortedEntries()) {
      if (!this.isLive(entry)) continue;
      const fn = entry.hooks[hookName];
      if (typeof fn !== 'function') continue;
      try {
        fn(...args);
      } catch (error) {
        entry.quarantined = true;
        failed = true;
        reportFailure(error, `render hook "${hookName}" failed`);
      }
    }
    return failed;
  }

  has(hookName: keyof T & string): boolean {
    return this.entries.some(
      (entry) => this.isLive(entry) && typeof entry.hooks[hookName] === 'function',
    );
  }

  /** Stores the host's render-time capability requirement for this surface. */
  setRequiredCapabilities(capabilities: readonly string[]): void {
    this.requiredCapabilities = [...capabilities];
  }

  /** Required (stored plus `extra`) capabilities with no enabled, unquarantined satisfier. */
  getMissingCapabilities(extra: readonly string[] = NONE): string[] {
    const missing: string[] = [];
    for (const capability of [...this.requiredCapabilities, ...extra]) {
      if (!missing.includes(capability) && !this.isActive(capability)) missing.push(capability);
    }
    return missing;
  }

  /** True when a requirement is missing or a quarantined entry was required; allocation-free. */
  isFailClosed(extra: readonly string[] = NONE): boolean {
    for (const capability of this.requiredCapabilities) {
      if (!this.isActive(capability)) return true;
    }
    for (const capability of extra) {
      if (!this.isActive(capability)) return true;
    }
    for (const entry of this.entries) {
      if (!entry.quarantined) continue;
      if (entry.required) return true;
      for (const capability of entry.satisfies) {
        if (this.requiredCapabilities.includes(capability) || extra.includes(capability)) {
          return true;
        }
      }
    }
    return false;
  }

  getSatisfiedCapabilities(): string[] {
    return [...this.capabilityCounts.keys()];
  }

  clear(): void {
    this.entries.length = 0;
    this.capabilityCounts.clear();
    this.requiredCapabilities = NONE;
  }

  private sortedEntries(): InternalEntry<T>[] {
    return [...this.entries].sort((a, b) => {
      const slotDiff = SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot];
      if (slotDiff !== 0) return slotDiff;
      const prioDiff = a.priority - b.priority;
      if (prioDiff !== 0) return prioDiff;
      return a.insertionOrder - b.insertionOrder;
    });
  }

  private isActive(capability: string): boolean {
    for (const entry of this.entries) {
      if (entry.satisfies.includes(capability) && this.isLive(entry)) return true;
    }
    return false;
  }

  private isLive(entry: InternalEntry<T>): boolean {
    return !entry.quarantined && this.isEnabled(entry);
  }

  private isEnabled(entry: InternalEntry<T>): boolean {
    try {
      return entry.enabled?.() ?? true;
    } catch {
      return false;
    }
  }
}

// ─── Per-surface render hook interfaces ─────────────────────────────────────

export interface RenderSurfaceDimensions {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- type alias required for Record<string, unknown> constraint
export type ViewportRenderHooks = {
  beforeElements?(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    dimensions: RenderSurfaceDimensions,
  ): void;
  afterElements?(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    dimensions: RenderSurfaceDimensions,
  ): void;
  afterAll?(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    dimensions: RenderSurfaceDimensions,
  ): void;
};

export interface MinimapMapping {
  readonly ctx: CanvasRenderingContext2D;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly worldBounds: { x: number; y: number; w: number; h: number };
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- type alias required for Record<string, unknown> constraint
export type MinimapRenderHooks = {
  afterElements?(mapping: MinimapMapping): void;
};

export interface ImageExportMapping {
  readonly ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- type alias required for Record<string, unknown> constraint
export type ImageExportHooks = {
  afterElements?(mapping: ImageExportMapping): void;
};

export interface SvgExportMapping {
  readonly appendSvg: (fragment: string) => void;
  readonly viewBox: { x: number; y: number; w: number; h: number };
  readonly rasterScale: number;
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- type alias required for Record<string, unknown> constraint
export type SvgExportHooks = {
  afterElements?(mapping: SvgExportMapping): void;
};

export interface RenderHooks {
  readonly viewport: TypedHookRegistry<ViewportRenderHooks>;
  readonly minimap: TypedHookRegistry<MinimapRenderHooks>;
  readonly imageExport: TypedHookRegistry<ImageExportHooks>;
  readonly svgExport: TypedHookRegistry<SvgExportHooks>;
}

export function createRenderHooks(): RenderHooks {
  return {
    viewport: new TypedHookRegistry<ViewportRenderHooks>(),
    minimap: new TypedHookRegistry<MinimapRenderHooks>(),
    imageExport: new TypedHookRegistry<ImageExportHooks>(),
    svgExport: new TypedHookRegistry<SvgExportHooks>(),
  };
}
