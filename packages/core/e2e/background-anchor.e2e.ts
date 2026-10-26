import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/canvas-page';

interface CameraState {
  x: number;
  y: number;
  zoom: number;
  dpr: number;
}

interface Probe {
  label: string;
  x: number;
  y: number;
  expectDot: boolean;
}

type CameraAction = 'none' | 'pan' | 'zoom';

async function applyAndSettle(page: Page, action: CameraAction): Promise<CameraState> {
  return page.evaluate(async (act) => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      camera: {
        position: { x: number; y: number };
        zoom: number;
        pan(dx: number, dy: number): void;
        zoomAt(level: number, screenPoint: { x: number; y: number }): void;
      };
    };
    if (act === 'pan') vp.camera.pan(37.3, 21.7);
    if (act === 'zoom') vp.camera.zoomAt(1.5, { x: 200, y: 150 });
    for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(r));
    const { x, y } = vp.camera.position;
    return { x, y, zoom: vp.camera.zoom, dpr: devicePixelRatio };
  }, action);
}

// Demo background: dots, spacing 24 world units, doubled while under 16 CSS px.
function predictProbes(cam: CameraState): Probe[] {
  let s = 24 * cam.zoom;
  while (s < 16) s *= 2;
  const offX = ((cam.x % s) + s) % s;
  const offY = ((cam.y % s) + s) % s;
  const probes: Probe[] = [];
  for (let n = 4; n <= 8; n++) {
    for (let m = 4; m <= 6; m++) {
      const cssX = offX + n * s;
      const cssY = offY + m * s;
      probes.push({
        label: `dot ${n},${m}`,
        x: cssX * cam.dpr,
        y: cssY * cam.dpr,
        expectDot: true,
      });
      probes.push({
        label: `gap ${n},${m}`,
        x: (cssX + s / 2) * cam.dpr,
        y: cssY * cam.dpr,
        expectDot: false,
      });
    }
  }
  return probes;
}

async function readAlphas(page: Page, probes: Probe[]): Promise<number[]> {
  return page.evaluate((points) => {
    const base = document.querySelector('#canvas canvas:not([data-paint-order])');
    if (!(base instanceof HTMLCanvasElement)) throw new Error('base canvas not found');
    const ctx = base.getContext('2d');
    if (!ctx) throw new Error('base canvas has no 2d context');
    return points.map((p) => ctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data[3] ?? 0);
  }, probes);
}

test.describe('background pattern anchoring', () => {
  // Fractional DPR on desktop-chrome; the ipad preset keeps its DPR 2.
  test.use({
    deviceScaleFactor: async ({ isMobile }, use) => use(isMobile ? 2 : 1.5),
  });

  test('dots sit at world-anchored positions after pan and zoom', async ({ canvasPage }) => {
    const page = canvasPage.page;
    for (const action of ['none', 'pan', 'zoom'] as const) {
      const cam = await applyAndSettle(page, action);
      const probes = predictProbes(cam);
      const alphas = await readAlphas(page, probes);
      const misplaced = probes
        .filter((p, i) => (alphas[i] ?? 0) > 0 !== p.expectDot)
        .map((p) => p.label);
      expect(
        misplaced,
        `pattern not anchored to world after '${action}' (camera ${JSON.stringify(cam)})`,
      ).toEqual([]);
    }
  });
});
