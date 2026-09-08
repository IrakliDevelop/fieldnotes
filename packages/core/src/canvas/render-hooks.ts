import type { Camera } from './camera';

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
  /** Runtime visibility predicate; disabled hooks keep their registered capabilities. */
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
}

export class TypedHookRegistry<T extends Record<string, unknown>> {
  private readonly entries: InternalEntry<T>[] = [];
  private readonly capabilityCounts = new Map<string, number>();
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
    const sorted = [...this.entries].sort((a, b) => {
      const slotDiff = SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot];
      if (slotDiff !== 0) return slotDiff;
      const prioDiff = a.priority - b.priority;
      if (prioDiff !== 0) return prioDiff;
      return a.insertionOrder - b.insertionOrder;
    });

    for (const entry of sorted) {
      if (!this.isEnabled(entry)) continue;
      const fn = entry.hooks[hookName];
      if (typeof fn === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        yield fn as (...args: any[]) => void;
      }
    }
  }

  has(hookName: keyof T & string): boolean {
    return this.entries.some(
      (entry) => this.isEnabled(entry) && typeof entry.hooks[hookName] === 'function',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic hook dispatcher
  *iterateRequired(): Generator<(...args: any[]) => void> {
    const sorted = [...this.entries]
      .filter((e) => e.required)
      .sort((a, b) => {
        const slotDiff = SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot];
        if (slotDiff !== 0) return slotDiff;
        const prioDiff = a.priority - b.priority;
        if (prioDiff !== 0) return prioDiff;
        return a.insertionOrder - b.insertionOrder;
      });

    for (const entry of sorted) {
      if (!this.isEnabled(entry)) continue;
      for (const fn of Object.values(entry.hooks)) {
        if (typeof fn === 'function') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          yield fn as (...args: any[]) => void;
        }
      }
    }
  }

  getSatisfiedCapabilities(): string[] {
    return [...this.capabilityCounts.keys()];
  }

  clear(): void {
    this.entries.length = 0;
    this.capabilityCounts.clear();
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
