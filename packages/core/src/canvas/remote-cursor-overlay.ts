import type { OverlayRenderer } from './render-loop';
import type { Peer, PeerRoster } from './awareness-roster';

/** The viewport capabilities the overlay needs; `Viewport` satisfies it. */
export interface RemoteCursorOverlayHost {
  registerOverlay(draw: OverlayRenderer): () => void;
  requestRender(): void;
  /** Read at draw time so glyph and label keep a constant screen size. */
  readonly camera: { readonly zoom: number };
}

export interface RemoteCursorOverlayOptions {
  /**
   * Host colour resolver consulted first (e.g. a campaign's per-player colour
   * table keyed by `peer.id`). Return `undefined` to fall through to the wire
   * `color`, then to `defaultPeerColor(peer.id)`.
   */
  colorFor?: (peer: Peer) => string | undefined;
  /** Draw the name chip next to the arrow. Default `true`. */
  showLabels?: boolean;
  /** Default `'12px sans-serif'`. */
  labelFont?: string;
}

/** Twelve well-separated hues so peers stay distinguishable without a colour on the wire. */
export const PEER_COLORS: readonly string[] = Object.freeze([
  '#e11d48',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#0d9488',
  '#0284c7',
  '#2563eb',
  '#7c3aed',
  '#c026d3',
  '#db2777',
  '#4d7c0f',
  '#b45309',
]);

/**
 * Deterministic palette colour for a stable peer id (FNV-1a over UTF-16 code
 * units), so every client shows the same peer in the same colour without any
 * colour travelling on the wire.
 */
export function defaultPeerColor(seed: string): string {
  if (seed.length === 0) return PEER_COLORS[0] ?? '#2563eb';
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return PEER_COLORS[hash % PEER_COLORS.length] ?? '#2563eb';
}

const DEFAULT_LABEL_FONT = '12px sans-serif';
const LABEL_PAD_X = 6;
const LABEL_PAD_Y = 3;
const LABEL_HEIGHT = 16;
const LABEL_OFFSET = 14;

/**
 * Renders every roster peer that has a cursor as an arrow glyph plus a name
 * chip, in world space but at constant screen size (scaled by `1 / zoom`).
 * Names are drawn as canvas text, so untrusted display text is inert. Reads
 * the roster only; never re-parses payloads, never moves the camera, never
 * touches the store.
 */
export class RemoteCursorOverlay {
  private readonly host: RemoteCursorOverlayHost;
  private readonly roster: PeerRoster;
  private readonly colorFor: ((peer: Peer) => string | undefined) | undefined;
  private readonly showLabels: boolean;
  private readonly labelFont: string;
  private readonly labelWidths = new Map<string, number>();
  private unregister: (() => void) | null;
  private unsubscribe: (() => void) | null;
  private isDisposed = false;

  constructor(
    host: RemoteCursorOverlayHost,
    roster: PeerRoster,
    options: RemoteCursorOverlayOptions = {},
  ) {
    this.host = host;
    this.roster = roster;
    this.colorFor = options.colorFor;
    this.showLabels = options.showLabels ?? true;
    this.labelFont = options.labelFont ?? DEFAULT_LABEL_FONT;
    this.unregister = host.registerOverlay((ctx) => this.render(ctx));
    this.unsubscribe = roster.onChange(() => host.requestRender());
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  resolveColor(peer: Peer): string {
    return this.colorFor?.(peer) ?? peer.color ?? defaultPeerColor(peer.id);
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unregister?.();
    this.unregister = null;
    this.labelWidths.clear();
    this.host.requestRender();
  }

  private render(ctx: CanvasRenderingContext2D): void {
    if (this.isDisposed) return;
    const zoom = this.host.camera.zoom;
    const inv = zoom > 0 && Number.isFinite(zoom) ? 1 / zoom : 1;
    for (const peer of this.roster.getPeers()) {
      if (peer.cursor === null) continue;
      const color = this.resolveColor(peer);
      ctx.save();
      ctx.translate(peer.cursor.x, peer.cursor.y);
      ctx.scale(inv, inv);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 16);
      ctx.lineTo(4.5, 12.5);
      ctx.lineTo(11, 12.5);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (this.showLabels && peer.name !== undefined && peer.name.length > 0) {
        this.drawLabel(ctx, peer.name, color);
      }
      ctx.restore();
    }
  }

  private drawLabel(ctx: CanvasRenderingContext2D, name: string, color: string): void {
    ctx.font = this.labelFont;
    const key = `${this.labelFont} ${name}`;
    let width = this.labelWidths.get(key);
    if (width === undefined) {
      width = ctx.measureText(name).width;
      this.labelWidths.set(key, width);
    }
    const w = width + LABEL_PAD_X * 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(LABEL_OFFSET, LABEL_OFFSET, w, LABEL_HEIGHT + LABEL_PAD_Y, 4);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, LABEL_OFFSET + LABEL_PAD_X, LABEL_OFFSET + (LABEL_HEIGHT + LABEL_PAD_Y) / 2);
  }
}
