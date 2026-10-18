/** Repaints only overlays when the host supports it, otherwise the whole frame. */
export function repaint(host: { requestRender(): void; requestOverlayRender?(): void }): void {
  if (host.requestOverlayRender) host.requestOverlayRender();
  else host.requestRender();
}
