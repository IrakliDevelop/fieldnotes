import type { OverlayRenderer } from './render-loop';
import type { ElementStore } from '../elements/element-store';
import type { LayerManager } from '../layers/layer-manager';
import { computeElementRects } from './element-rect-tracker';
import type { ElementRect } from './element-rect-tracker';
import type { Peer, PeerRoster } from './awareness-roster';
import { defaultPeerColor } from './remote-cursor-overlay';

/** The viewport capabilities the overlay needs; `Viewport` satisfies it. */
export interface RemoteSelectionOverlayHost {
  registerOverlay(draw: OverlayRenderer): () => void;
  requestRender(): void;
  readonly camera: { readonly zoom: number };
  readonly store: ElementStore;
  readonly layerManager: LayerManager;
}

export interface RemoteSelectionOverlayOptions {
  /** Same precedence as `RemoteCursorOverlay`: resolver → wire colour → `defaultPeerColor`. */
  colorFor?: (peer: Peer) => string | undefined;
  /** Outline opacity. Default `0.6`. */
  alpha?: number;
  /** Outline width in screen pixels. Default `2`. */
  lineWidthPx?: number;
}

interface PeerSignature {
  from: string;
  selection: readonly string[];
  color: string;
}

interface Outline {
  rect: ElementRect;
  color: string;
}

const DEFAULT_ALPHA = 0.6;
const DEFAULT_LINE_WIDTH_PX = 2;

/**
 * Outlines the elements other peers have selected. Only ids that exist in the
 * LOCAL store AND sit on a locally visible layer are drawn; this is a
 * rendering courtesy on top of the sender-side opt-in (`fields.selection`) and
 * `selectionFilter` — privacy is decided at publish time, not here. The store
 * is rescanned only when some peer's selection reference or resolved colour
 * changed, or when the store or layer visibility changed; cursor-only roster
 * updates never scan.
 */
export class RemoteSelectionOverlay {
  private readonly host: RemoteSelectionOverlayHost;
  private readonly roster: PeerRoster;
  private readonly colorFor: ((peer: Peer) => string | undefined) | undefined;
  private readonly alpha: number;
  private readonly lineWidthPx: number;
  private signatures: readonly PeerSignature[] = [];
  private outlines: readonly Outline[] = [];
  private storeDirty = true;
  private unregister: (() => void) | null;
  private readonly unsubscribers: (() => void)[] = [];
  private isDisposed = false;

  constructor(
    host: RemoteSelectionOverlayHost,
    roster: PeerRoster,
    options: RemoteSelectionOverlayOptions = {},
  ) {
    this.host = host;
    this.roster = roster;
    this.colorFor = options.colorFor;
    this.alpha = options.alpha ?? DEFAULT_ALPHA;
    this.lineWidthPx = options.lineWidthPx ?? DEFAULT_LINE_WIDTH_PX;
    this.unregister = host.registerOverlay((ctx) => this.render(ctx));
    const invalidate = (): void => {
      this.storeDirty = true;
      host.requestRender();
    };
    this.unsubscribers.push(
      roster.onChange(() => host.requestRender()),
      host.store.onChange(invalidate),
      host.layerManager.on('change', invalidate),
    );
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers.length = 0;
    this.unregister?.();
    this.unregister = null;
    this.signatures = [];
    this.outlines = [];
    this.host.requestRender();
  }

  private resolveColor(peer: Peer): string {
    return this.colorFor?.(peer) ?? peer.color ?? defaultPeerColor(peer.id);
  }

  /** Recomputes outlines only when the selection signature or the store/layers changed. */
  private rebuild(): void {
    const peers = this.roster.getPeers();
    const next: PeerSignature[] = [];
    for (const peer of peers) {
      if (peer.selection.length === 0) continue;
      next.push({ from: peer.from, selection: peer.selection, color: this.resolveColor(peer) });
    }
    let changed = this.storeDirty || next.length !== this.signatures.length;
    if (!changed) {
      for (let i = 0; i < next.length; i++) {
        const a = next[i];
        const b = this.signatures[i];
        if (!a || !b || a.from !== b.from || a.selection !== b.selection || a.color !== b.color) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) return;
    this.storeDirty = false;
    this.signatures = next;
    if (next.length === 0) {
      this.outlines = [];
      return;
    }
    const colorById = new Map<string, string>();
    for (const sig of next) {
      for (const id of sig.selection) if (!colorById.has(id)) colorById.set(id, sig.color);
    }
    const layers = this.host.layerManager;
    const rects = computeElementRects(this.host.store, (element) =>
      colorById.has(element.id) && layers.isLayerVisible(element.layerId) ? element.id : null,
    );
    this.outlines = rects.map((rect) => ({ rect, color: colorById.get(rect.id) ?? '#2563eb' }));
  }

  private render(ctx: CanvasRenderingContext2D): void {
    if (this.isDisposed) return;
    this.rebuild();
    if (this.outlines.length === 0) return;
    const zoom = this.host.camera.zoom;
    const inv = zoom > 0 && Number.isFinite(zoom) ? 1 / zoom : 1;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.lineWidth = this.lineWidthPx * inv;
    for (const { rect, color } of this.outlines) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
      if (rect.rotation !== 0) ctx.rotate(rect.rotation);
      ctx.strokeRect(-rect.w / 2, -rect.h / 2, rect.w, rect.h);
      ctx.restore();
    }
    ctx.restore();
  }
}
