import { vi } from 'vitest';
import type { OverlayRenderer } from '../render-loop';
import type { RemotePingOverlayHost } from '../remote-ping-overlay';

/**
 * Shared overlay-host test double. Any collaborator that only needs the
 * `registerOverlay`/`requestRender` pair — `RemotePingOverlayHost`,
 * `RemoteFocusReceiverHost` — is structurally satisfied by this host, so it
 * is shared rather than redefined per test file. `remote-laser-overlay.test.ts`
 * and `remote-measure-overlay.test.ts` define their own host/context doubles
 * with materially different shapes (extra canvas methods, different
 * bookkeeping) and are intentionally left alone; see task-6 report.
 */
export function makeHost(): {
  host: RemotePingOverlayHost;
  getRenderer: () => OverlayRenderer | null;
  unregister: ReturnType<typeof vi.fn>;
  requestRender: ReturnType<typeof vi.fn>;
} {
  let renderer: OverlayRenderer | null = null;
  const unregister = vi.fn(() => {
    renderer = null;
  });
  const requestRender = vi.fn();
  return {
    host: {
      registerOverlay: (draw: OverlayRenderer) => {
        renderer = draw;
        return unregister;
      },
      requestRender,
    },
    getRenderer: () => renderer,
    unregister,
    requestRender,
  };
}

export function makeMockCtx(arcs: number[], alphas: number[]): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn((_x: number, _y: number, r: number) => arcs.push(r)),
    stroke: vi.fn(),
    fill: vi.fn(),
    set globalAlpha(v: number) {
      alphas.push(v);
    },
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D;
}
