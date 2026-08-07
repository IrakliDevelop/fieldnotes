import type { CameraAnimator } from './camera-animator';
import { isFocusPresence, type FocusAudience } from './focus-presence';
import { RemotePingOverlay, type RemotePingOverlayHost } from './remote-ping-overlay';

export type FocusRole = 'dm' | 'player' | 'display';

/** The two viewport capabilities the receiver needs; `Viewport` satisfies it. */
export type RemoteFocusReceiverHost = RemotePingOverlayHost;

export interface RemoteFocusReceiverOptions {
  role: FocusRole;
  animator: CameraAnimator;
  /** Draw an arrival pulse at the focus target. Default `true`. */
  pulse?: boolean;
  pulseColor?: string;
  pulseDurationMs?: number;
  pulseRadius?: number;
  /** Animate the camera (default) or jump instantly. */
  animate?: boolean;
}

function audienceIncludes(audience: FocusAudience, role: FocusRole): boolean {
  if (role === 'dm') return false; // a DM device is never moved by a focus frame
  if (audience === 'all') return true;
  if (audience === 'players') return role === 'player';
  return role === 'display';
}

/**
 * Applies remote focus requests addressed to this client's role: moves the
 * camera and marks the target with one pulse.
 *
 * The pulse is DELEGATED to a private `RemotePingOverlay` rather than
 * reimplemented. `renderPingPulse` draws a single frame from an elapsed time,
 * so an animated pulse needs a rAF loop that re-requests renders, expires the
 * pulse, and cancels on disposal — machinery that already exists and is tested
 * there. `maxPingsPerSender: 1` makes a rapid second focus REPLACE the older
 * pulse instead of leaving two competing markers; different senders keep
 * separate keys and coexist, which is correct when two DMs share a table.
 */
export class RemoteFocusReceiver {
  private readonly role: FocusRole;
  private readonly animator: CameraAnimator;
  private readonly animate: boolean;
  private readonly pulseColor: string | undefined;
  private readonly overlay: RemotePingOverlay | null;
  private disposed = false;

  constructor(host: RemoteFocusReceiverHost, options: RemoteFocusReceiverOptions) {
    this.role = options.role;
    this.animator = options.animator;
    this.animate = options.animate ?? true;
    this.pulseColor = options.pulseColor;
    this.overlay =
      (options.pulse ?? true)
        ? new RemotePingOverlay(host, {
            ...(options.pulseColor === undefined ? {} : { color: options.pulseColor }),
            ...(options.pulseDurationMs === undefined
              ? {}
              : { durationMs: options.pulseDurationMs }),
            ...(options.pulseRadius === undefined ? {} : { radius: options.pulseRadius }),
            maxPingsPerSender: 1,
          })
        : null;
  }

  /**
   * Applies a presence payload from `sender`. Returns `false` for payloads
   * that are not focus frames, or are addressed to a different role, so hosts
   * can feed every presence frame through without disturbing other handlers.
   */
  apply(from: string, data: unknown): boolean {
    if (this.disposed || !isFocusPresence(data)) return false;
    if (!audienceIncludes(data.audience, this.role)) return false;

    const view = { x: data.x, y: data.y, w: data.w, h: data.h };
    // `isFocusPresence` enforces the same rules as CameraView validation, so
    // wire data cannot make the animator's synchronous validation throw here.
    if (this.animate) {
      this.animator.animateTo(view);
    } else {
      this.animator.jumpTo(view);
    }

    this.overlay?.apply(from, {
      kind: 'ping',
      x: view.x + view.w / 2,
      y: view.y + view.h / 2,
      color: data.color ?? this.pulseColor,
    });
    return true;
  }

  /** Idempotent. Does NOT dispose the animator — the host owns that. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.overlay?.dispose();
  }
}
