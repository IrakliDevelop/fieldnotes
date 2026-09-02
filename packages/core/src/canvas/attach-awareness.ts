import type { Point } from '../core/types';
import type { ElementStore } from '../elements/element-store';
import type { LayerManager } from '../layers/layer-manager';
import { LocalAwareness } from './awareness-publisher';
import type { AwarenessFields, LocalAwarenessOptions } from './awareness-publisher';
import { PeerRoster } from './awareness-roster';
import type { PeerRosterOptions } from './awareness-roster';
import { RemoteCursorOverlay } from './remote-cursor-overlay';
import type { RemoteCursorOverlayOptions } from './remote-cursor-overlay';
import { RemoteSelectionOverlay } from './remote-selection-overlay';
import type { RemoteSelectionOverlayOptions } from './remote-selection-overlay';
import type { OverlayRenderer } from './render-loop';

/**
 * The three presence primitives every Field Notes transport exposes. The raw
 * `SyncClient`, `ManagedSyncConnection`, and host wrappers all satisfy it
 * structurally, so core never depends on `@fieldnotes/sync`. `from` is the
 * relay's opaque per-sender key.
 */
export interface PresenceChannel {
  sendPresence(data: unknown): void;
  onPresence(handler: (from: string, data: unknown) => void): () => void;
  onPresenceLeave(handler: (from: string) => void): () => void;
}

/**
 * What `attachAwareness` needs from a viewport; `Viewport` satisfies it.
 *
 * This does not `extends LocalAwarenessHost, RemoteCursorOverlayHost,
 * RemoteSelectionOverlayHost`: those three declare `camera` with different
 * member sets (`screenToWorld` vs `zoom`), and TypeScript rejects an
 * interface that extends multiple parents whose same-named property types
 * are not identical or mutually assignable. Listing the members directly
 * (with `camera` widened to carry both) keeps `AwarenessViewport`
 * structurally assignable to all three host types.
 */
export interface AwarenessViewport {
  readonly camera: { readonly zoom: number; screenToWorld(screen: Point): Point };
  /** The pointer listener attaches to `domLayer.parentElement` (the wrapper). */
  readonly domLayer: HTMLElement;
  readonly store: ElementStore;
  readonly layerManager: LayerManager;
  onSelectionChange(listener: () => void): () => void;
  getSelectedIds(): string[];
  readonly toolManager: {
    onChange(listener: (name: string) => void): () => void;
    readonly activeTool: { readonly name: string } | null;
  };
  registerOverlay(draw: OverlayRenderer): () => void;
  requestRender(): void;
}

export interface AttachAwarenessOptions extends Omit<LocalAwarenessOptions, 'send'> {
  roster?: PeerRosterOptions;
  /** Named cursor overlay options, or `false` to render no cursors. Default on. */
  cursors?: RemoteCursorOverlayOptions | false;
  /** Selection outline overlay: options or `true` to enable. Default off. */
  selections?: RemoteSelectionOverlayOptions | boolean;
  /**
   * `false` builds a receive-only attachment (no `LocalAwareness`). Default
   * `true`. When `false`, `identity` is ignored: there is no publisher to
   * carry it.
   */
  publish?: boolean;
}

export interface AwarenessHandle {
  readonly roster: PeerRoster;
  /** `null` when `publish: false`. */
  readonly local: LocalAwareness | null;
  readonly cursors: RemoteCursorOverlay | null;
  readonly selections: RemoteSelectionOverlay | null;
  /** Call when the connection becomes live or reconnects. No-op when receive-only. */
  announce(): void;
  /** Forwards to `LocalAwareness.setFields` (merge). No-op when receive-only. */
  setFields(fields: AwarenessFields): void;
  dispose(): void;
}

/**
 * Binds the awareness lifecycle to a presence channel: incoming frames feed
 * the roster, presence-leave drops rows and discovery budget, and each newly
 * discovered sender makes this client re-announce once, coalesced by the
 * publisher's interval: from a cold start the first discovery goes out on
 * the leading edge and later ones fold into a single trailing frame, so N
 * simultaneous joiners cost at most two frames; while already active, one.
 * Dispose order: publisher (sends `cleared`) → overlays → roster → channel
 * unsubscribes.
 */
export function attachAwareness(
  viewport: AwarenessViewport,
  channel: PresenceChannel,
  options: AttachAwarenessOptions,
): AwarenessHandle {
  const {
    roster: rosterOptions,
    cursors: cursorOptions,
    selections: selectionOptions,
    publish,
    ...localOptions
  } = options;
  const roster = new PeerRoster(rosterOptions);
  let local: LocalAwareness | null = null;
  let cursors: RemoteCursorOverlay | null = null;
  let selections: RemoteSelectionOverlay | null = null;
  // Registering the channel subscriptions lives inside this same guarded
  // section: if `onPresence` or `onPresenceLeave` throws (a transport already
  // tearing down, say), everything already built above must not leak with no
  // handle to dispose it.
  const unsubscribers: (() => void)[] = [];
  try {
    local =
      publish === false
        ? null
        : new LocalAwareness(viewport, {
            ...localOptions,
            send: (data) => channel.sendPresence(data),
          });
    cursors =
      cursorOptions === false
        ? null
        : new RemoteCursorOverlay(viewport, roster, cursorOptions ?? {});
    selections =
      selectionOptions === undefined || selectionOptions === false
        ? null
        : new RemoteSelectionOverlay(
            viewport,
            roster,
            selectionOptions === true ? {} : selectionOptions,
          );
    if (publish !== false) unsubscribers.push(roster.onDiscover(() => local?.announce()));
    unsubscribers.push(
      channel.onPresence((from, data) => {
        roster.apply(from, data);
      }),
    );
    unsubscribers.push(channel.onPresenceLeave((from) => roster.remove(from)));
  } catch (error) {
    for (let i = unsubscribers.length - 1; i >= 0; i--) {
      try {
        unsubscribers[i]?.();
      } catch {
        // The original error is what surfaces.
      }
    }
    unsubscribers.length = 0;
    try {
      selections?.dispose();
    } catch {
      // The original error is what surfaces.
    }
    try {
      cursors?.dispose();
    } catch {
      // The original error is what surfaces.
    }
    try {
      local?.dispose();
    } catch {
      // The original error is what surfaces.
    }
    try {
      roster.dispose();
    } catch {
      // The original error is what surfaces.
    }
    throw error;
  }
  let disposed = false;
  return {
    roster,
    local,
    cursors,
    selections,
    announce: () => local?.announce(),
    setFields: (fields) => local?.setFields(fields),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      // Each step is guarded so one throwing collaborator cannot skip the
      // rest of the documented teardown order.
      try {
        local?.dispose();
      } catch {
        // Keep unwinding regardless.
      }
      try {
        cursors?.dispose();
      } catch {
        // Keep unwinding regardless.
      }
      try {
        selections?.dispose();
      } catch {
        // Keep unwinding regardless.
      }
      try {
        roster.dispose();
      } catch {
        // Keep unwinding regardless.
      }
      for (const unsub of unsubscribers) {
        try {
          unsub();
        } catch {
          // Keep unwinding regardless.
        }
      }
      unsubscribers.length = 0;
    },
  };
}
