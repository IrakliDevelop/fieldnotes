import { test, expect } from './fixtures/canvas-page';

test('player fog occupies a paint stratum above DOM-backed elements', async ({ canvasPage }) => {
  const result = await canvasPage.page.evaluate(async () => {
    const globals = window as unknown as Record<string, unknown>;
    const viewport = globals.__fieldnotes_viewport as {
      camera: { screenToWorld(point: { x: number; y: number }): { x: number; y: number } };
      store: { add(element: unknown): void };
      requestRender(): void;
    };
    const fog = globals.__fieldnotes_fog_manager as {
      initialize(options: {
        bounds: { x: number; y: number; w: number; h: number };
        base: 'covered';
        cellSize: number;
      }): void;
      setViewMode(mode: 'player'): void;
    };
    const wrapper = document.querySelector('#canvas > div');
    if (!(wrapper instanceof HTMLDivElement)) throw new Error('missing viewport wrapper');
    const center = { x: wrapper.clientWidth / 2, y: wrapper.clientHeight / 2 };
    const world = viewport.camera.screenToWorld(center);
    viewport.store.add({
      id: 'fog-dom-note',
      type: 'note',
      position: { x: world.x - 50, y: world.y - 30 },
      size: { w: 100, h: 60 },
      zIndex: 0,
      locked: false,
      layerId: 'default-layer',
      text: 'SECRET',
      backgroundColor: '#ff0000',
      textColor: '#ffffff',
    });
    fog.initialize({
      bounds: { x: world.x - 256, y: world.y - 256, w: 512, h: 512 },
      base: 'covered',
      cellSize: 32,
    });
    fog.setViewMode('player');
    viewport.requestRender();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

    const note = wrapper.querySelector('[data-element-id="fog-dom-note"]');
    const noteStratum = note?.parentElement;
    const noteOrder = Number(noteStratum?.dataset['paintOrder']);
    const dpr = devicePixelRatio || 1;
    const painted = [...wrapper.querySelectorAll('canvas[data-paint-order]')]
      .filter((node): node is HTMLCanvasElement => node instanceof HTMLCanvasElement)
      .map((canvas) => ({
        canvas,
        order: Number(canvas.dataset['paintOrder']),
        alpha:
          canvas
            .getContext('2d')
            ?.getImageData(Math.floor(center.x * dpr), Math.floor(center.y * dpr), 1, 1)
            .data.at(3) ?? 0,
      }))
      .find((entry) => entry.order > noteOrder && entry.alpha > 0);
    if (!painted) throw new Error('missing painted fog canvas above the DOM stratum');

    return {
      sameStack: noteStratum?.parentElement === painted.canvas.parentElement,
      noteOrder,
      fogOrder: painted.order,
      alpha: painted.alpha,
    };
  });

  expect(result.sameStack).toBe(true);
  expect(result.fogOrder).toBeGreaterThan(result.noteOrder);
  expect(result.alpha).toBeGreaterThan(0);
});

test('player fog is included after scene elements in bitmap and SVG exports', async ({
  canvasPage,
}) => {
  const result = await canvasPage.page.evaluate(async () => {
    const globals = window as unknown as Record<string, unknown>;
    const viewport = globals.__fieldnotes_viewport as {
      store: { add(element: unknown): void };
      exportImage(options: { scale: number }): Promise<Blob | null>;
      exportSVG(): Promise<string>;
    };
    const fog = globals.__fieldnotes_fog_manager as {
      initialize(options: {
        bounds: { x: number; y: number; w: number; h: number };
        base: 'covered';
        cellSize: number;
      }): void;
      setViewMode(mode: 'player'): void;
    };
    viewport.store.add({
      id: 'fog-export-shape',
      type: 'shape',
      position: { x: 0, y: 0 },
      size: { w: 100, h: 60 },
      zIndex: 0,
      locked: false,
      layerId: 'default-layer',
      shape: 'rectangle',
      strokeColor: '#ff0000',
      strokeWidth: 0,
      fillColor: '#ff0000',
    });
    fog.initialize({
      bounds: { x: 0, y: 0, w: 128, h: 128 },
      base: 'covered',
      cellSize: 32,
    });
    fog.setViewMode('player');

    const blob = await viewport.exportImage({ scale: 1 });
    if (!blob) throw new Error('bitmap export unexpectedly empty');
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('missing export inspection context');
    ctx.drawImage(bitmap, 0, 0);
    const pixel = [...ctx.getImageData(50, 30, 1, 1).data];
    const svg = await viewport.exportSVG();

    return {
      pixel,
      sceneIndex: svg.indexOf('<rect'),
      fogIndex: svg.lastIndexOf('<image href="data:image/png'),
    };
  });

  expect(result.pixel[0]).toBeLessThan(100);
  expect(result.pixel[3]).toBe(255);
  expect(result.sceneIndex).toBeGreaterThanOrEqual(0);
  expect(result.fogIndex).toBeGreaterThan(result.sceneIndex);
});
