/**
 * Shared expanding-pulse rendering for map pings. Internal helper used by the
 * local `PingTool` overlay and the `RemotePingOverlay` so a viewer sees the
 * same animation for local and remote pings. Not part of the public API.
 */

export interface PingPulseStyle {
  color: string;
  /** Total animation length in milliseconds. */
  durationMs: number;
  /** Maximum ripple radius in world units. */
  radius: number;
}

/** Ripple start offsets as fractions of the total duration. */
const RIPPLE_OFFSETS = [0, 0.25] as const;

function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

/**
 * Draws one ping at world position (`x`, `y`) given its age. The context is
 * already in world space. Draws nothing once `ageMs >= durationMs`.
 */
export function renderPingPulse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ageMs: number,
  style: PingPulseStyle,
): void {
  if (ageMs < 0 || ageMs >= style.durationMs) return;

  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.fillStyle = style.color;

  for (const offset of RIPPLE_OFFSETS) {
    const rippleSpan = style.durationMs * (1 - offset);
    const rippleAge = ageMs - style.durationMs * offset;
    if (rippleAge < 0) continue;
    const progress = Math.min(1, rippleAge / rippleSpan);
    const rippleRadius = style.radius * easeOutCubic(progress);
    if (rippleRadius <= 0) continue;
    ctx.globalAlpha = Math.max(0, 1 - progress);
    ctx.lineWidth = Math.max(1.5, style.radius / 12);
    ctx.beginPath();
    ctx.arc(x, y, rippleRadius, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Center dot: solid for the first half, then fades with the ripples.
  const dotProgress = ageMs / style.durationMs;
  ctx.globalAlpha = Math.max(0, 1 - Math.max(0, dotProgress - 0.5) * 2);
  ctx.beginPath();
  ctx.arc(x, y, Math.max(2, style.radius / 8), 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
