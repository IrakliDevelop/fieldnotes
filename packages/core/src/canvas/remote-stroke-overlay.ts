import type { StrokePreview } from '../tools/pencil-tool';
import type { ElementStore } from '../elements/element-store';
import type { CurveSegment } from '../elements/stroke-smoothing';
import { pressureToWidth, smoothToSegments } from '../elements/stroke-smoothing';
import type { RemoteLaserOverlayHost } from './remote-laser-overlay';
import { repaint } from './overlay-repaint';

/**
 * The wire shape of a stroke-preview presence payload; `isStrokePreviewPresence`
 * validates a received payload before it reaches the overlay. Previews are
 * ephemeral: they travel as presence only, never as elements or history.
 */
export type StrokePreviewPresence = StrokePreview & { readonly kind: 'stroke' };

export const STROKE_PREVIEW_PRESENCE_KIND = 'stroke';

const MAX_PREVIEW_POINTS = 120;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function isPreviewPoint(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) return false;
  const [x, y, pressure] = value;
  return (
    isFiniteNumber(x) &&
    isFiniteNumber(y) &&
    (pressure === undefined || (isFiniteNumber(pressure) && pressure >= 0 && pressure <= 1))
  );
}

/** Validates a received presence payload as a stroke preview. */
export function isStrokePreviewPresence(data: unknown): data is StrokePreviewPresence {
  if (typeof data !== 'object' || data === null) return false;
  const payload = data as {
    kind?: unknown;
    id?: unknown;
    cleared?: unknown;
    points?: unknown;
    color?: unknown;
    width?: unknown;
    opacity?: unknown;
    blendMode?: unknown;
  };
  if (payload.kind !== STROKE_PREVIEW_PRESENCE_KIND || typeof payload.id !== 'string') {
    return false;
  }
  if (payload.cleared !== undefined) return payload.cleared === true;
  if (!Array.isArray(payload.points) || payload.points.length > MAX_PREVIEW_POINTS) return false;
  if (!payload.points.every(isPreviewPoint)) return false;
  if (typeof payload.color !== 'string') return false;
  if (!isFiniteNumber(payload.width) || payload.width <= 0) return false;
  if (payload.opacity !== undefined && !isFiniteNumber(payload.opacity)) return false;
  return payload.blendMode === undefined || payload.blendMode === 'multiply';
}

/** Builds the presence payload for one local `PencilTool` preview. */
export function toStrokePreviewPresence(preview: StrokePreview): StrokePreviewPresence {
  return { kind: STROKE_PREVIEW_PRESENCE_KIND, ...preview };
}

/** `RemoteLaserOverlayHost` plus the store whose committed strokes replace previews; `Viewport` satisfies it. */
export interface RemoteStrokeOverlayHost extends RemoteLaserOverlayHost {
  readonly store: ElementStore;
}

export interface RemoteStrokeOverlayOptions {
  /** A preview without an update for this long is dropped. Default `3000`. */
  staleMs?: number;
}

interface RemotePreview {
  segments: CurveSegment[];
  color: string;
  width: number;
  opacity: number;
  blendMode: 'multiply' | undefined;
  updatedAt: number;
}

const DEFAULT_STALE_MS = 3000;
const DEFAULT_PRESSURE = 0.5;
const MAX_PREVIEWS_PER_SENDER = 4;

/**
 * Draws remote peers' in-progress strokes on the overlay stratum, keyed by
 * sender and stroke id. A preview stays until the committed stroke with its id
 * enters the store, it goes stale, the sender clears it, or `remove()` runs
 * (wire that to `presence-leave`), so the committed stroke replaces it without a gap.
 */
export class RemoteStrokeOverlay {
  private readonly host: RemoteStrokeOverlayHost;
  private readonly staleMs: number;
  private readonly senders = new Map<string, Map<string, RemotePreview>>();
  private readonly unsubscribeStore: () => void;
  private unregister: (() => void) | null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(host: RemoteStrokeOverlayHost, options: RemoteStrokeOverlayOptions = {}) {
    this.host = host;
    this.staleMs = options.staleMs ?? DEFAULT_STALE_MS;
    this.unregister = host.registerOverlay((ctx) => this.render(ctx));
    this.unsubscribeStore = host.store.on('add', (element) => this.drop(element.id));
  }

  private now(): number {
    return performance.now();
  }

  /**
   * Applies a presence payload from `sender`. Non-stroke or malformed payloads
   * are ignored and reported as `false`, so hosts can feed every presence frame through.
   */
  apply(sender: string, data: unknown): boolean {
    if (this.disposed || !isStrokePreviewPresence(data)) return false;
    if ('cleared' in data) {
      this.drop(data.id, sender);
      return true;
    }
    if (this.host.store.getById(data.id)) return true;
    let previews = this.senders.get(sender);
    if (!previews) {
      previews = new Map();
      this.senders.set(sender, previews);
    }
    // Re-insert so iteration order runs from least to most recently updated.
    previews.delete(data.id);
    previews.set(data.id, {
      segments: smoothToSegments(
        data.points.map(([x, y, pressure]) => ({ x, y, pressure: pressure ?? DEFAULT_PRESSURE })),
      ),
      color: data.color,
      width: data.width,
      opacity: data.opacity ?? 1,
      blendMode: data.blendMode,
      updatedAt: this.now(),
    });
    const oldest = previews.keys().next().value;
    if (previews.size > MAX_PREVIEWS_PER_SENDER && oldest !== undefined) previews.delete(oldest);
    this.scheduleExpiry();
    repaint(this.host);
    return true;
  }

  /** Removes a sender's previews immediately (presence-leave/disconnect). */
  remove(sender: string): void {
    if (this.senders.delete(sender)) repaint(this.host);
  }

  /** Number of senders with at least one live preview. */
  get activeSenderCount(): number {
    return this.senders.size;
  }

  /** Unregisters the overlay, the store listener, and the expiry timer. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.senders.clear();
    this.unsubscribeStore();
    this.unregister?.();
    this.unregister = null;
  }

  /** Drops the preview `id` from `sender`, or from every sender when omitted. */
  private drop(id: string, sender?: string): void {
    let dropped = false;
    for (const [key, previews] of this.senders) {
      if (sender !== undefined && key !== sender) continue;
      if (previews.delete(id)) dropped = true;
      if (previews.size === 0) this.senders.delete(key);
    }
    if (dropped) repaint(this.host);
  }

  private scheduleExpiry(): void {
    if (this.timer !== null) return;
    let earliest = Infinity;
    for (const previews of this.senders.values()) {
      for (const preview of previews.values()) earliest = Math.min(earliest, preview.updatedAt);
    }
    if (earliest === Infinity) return;
    this.timer = setTimeout(() => this.expire(), Math.max(0, earliest + this.staleMs - this.now()));
  }

  private expire(): void {
    this.timer = null;
    const cutoff = this.now() - this.staleMs;
    let dropped = false;
    for (const [sender, previews] of this.senders) {
      for (const [id, preview] of previews) {
        if (preview.updatedAt > cutoff) continue;
        previews.delete(id);
        dropped = true;
      }
      if (previews.size === 0) this.senders.delete(sender);
    }
    if (dropped) repaint(this.host);
    this.scheduleExpiry();
  }

  private render(ctx: CanvasRenderingContext2D): void {
    for (const previews of this.senders.values()) {
      for (const preview of previews.values()) {
        ctx.save();
        ctx.strokeStyle = preview.color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = preview.opacity;
        if (preview.blendMode) ctx.globalCompositeOperation = preview.blendMode;
        for (const seg of preview.segments) {
          ctx.lineWidth =
            (pressureToWidth(seg.start.pressure, preview.width) +
              pressureToWidth(seg.end.pressure, preview.width)) /
            2;
          ctx.beginPath();
          ctx.moveTo(seg.start.x, seg.start.y);
          ctx.bezierCurveTo(seg.cp1.x, seg.cp1.y, seg.cp2.x, seg.cp2.y, seg.end.x, seg.end.y);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }
}
