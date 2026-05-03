interface StrokePoint {
  x: number;
  y: number;
  p: number;
}

interface Stroke {
  color: string;
  width: number;
  pts: StrokePoint[];
}

interface Camera {
  x: number;
  y: number;
  z: number;
}

function screenToWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return {
    x: (sx - cam.x) / cam.z,
    y: (sy - cam.y) / cam.z,
  };
}

function drawDots(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number): void {
  const spacing = 20 * cam.z;
  if (spacing < 6) return;

  const ox = ((cam.x % spacing) + spacing) % spacing;
  const oy = ((cam.y % spacing) + spacing) % spacing;
  const dotColor =
    getComputedStyle(document.documentElement).getPropertyValue('--dot').trim() || '#ccc';

  ctx.fillStyle = dotColor;
  for (let x = ox; x < w; x += spacing) {
    for (let y = oy; y < h; y += spacing) {
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function drawStroke(ctx: CanvasRenderingContext2D, cam: Camera, s: Stroke): void {
  if (s.pts.length < 2) {
    const p = s.pts[0];
    if (!p) return;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(p.x * cam.z + cam.x, p.y * cam.z + cam.y, (s.width * cam.z) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.strokeStyle = s.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 0; i < s.pts.length - 1; i++) {
    const p0 = s.pts[i];
    const p1 = s.pts[i + 1];
    if (!p0 || !p1) continue;
    const w = s.width * (0.6 + 0.8 * ((p0.p + p1.p) / 2));

    ctx.lineWidth = Math.max(0.5, w * cam.z);
    ctx.beginPath();

    const x0 = p0.x * cam.z + cam.x;
    const y0 = p0.y * cam.z + cam.y;
    const x1 = p1.x * cam.z + cam.x;
    const y1 = p1.y * cam.z + cam.y;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;

    if (i === 0) {
      ctx.moveTo(x0, y0);
      ctx.lineTo(mx, my);
    } else {
      const prev = s.pts[i - 1];
      if (!prev) continue;
      const px = prev.x * cam.z + cam.x;
      const py = prev.y * cam.z + cam.y;
      ctx.moveTo((px + x0) / 2, (py + y0) / 2);
      ctx.quadraticCurveTo(x0, y0, mx, my);
    }
    ctx.stroke();
  }
}

export function initMiniCanvas(): void {
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('c') as HTMLCanvasElement | null;
  const htmlLayer = document.getElementById('html-layer');
  const hudCoord = document.getElementById('hud-coord');
  const hudZoom = document.getElementById('hud-zoom');
  const btnClear = document.getElementById('btn-clear');
  const pageCoord = document.getElementById('page-coord');

  if (!stage || !canvas || !htmlLayer) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const stageEl = stage;
  const canvasEl = canvas;
  const htmlLayerEl = htmlLayer;
  const ctxEl = ctx;

  const cam: Camera = { x: 0, y: 0, z: 1 };
  let strokes: Stroke[] = [];
  let current: Stroke | null = null;
  let tool = 'pencil';
  let color = '#2a2824';
  let pressing = false;
  let lastPoint = { x: 0, y: 0 };
  let panStart: { x: number; y: number } | null = null;
  let camStart: { x: number; y: number } | null = null;

  // --- render ---

  function render(): void {
    const rect = canvasEl.getBoundingClientRect();
    ctxEl.clearRect(0, 0, rect.width, rect.height);
    drawDots(ctxEl, cam, rect.width, rect.height);

    for (const s of strokes) drawStroke(ctxEl, cam, s);
    if (current) drawStroke(ctxEl, cam, current);

    htmlLayerEl.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;

    const wx = Math.round(-cam.x / cam.z);
    const wy = Math.round(-cam.y / cam.z);
    if (hudCoord) hudCoord.textContent = `${wx}, ${wy}`;
    if (hudZoom) hudZoom.textContent = Math.round(cam.z * 100) + '%';
    if (pageCoord) pageCoord.textContent = `${wx}, ${wy}`;
  }

  // --- resize ---

  function resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = stageEl.getBoundingClientRect();
    canvasEl.width = rect.width * dpr;
    canvasEl.height = rect.height * dpr;
    canvasEl.style.width = rect.width + 'px';
    canvasEl.style.height = rect.height + 'px';
    ctxEl.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  window.addEventListener('resize', resize);

  // --- tool & color selection ---

  stageEl.querySelectorAll<HTMLElement>('.tool-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      tool = btn.dataset['tool'] || 'pencil';
      stageEl.querySelectorAll('.tool-btn').forEach((b) => b.classList.toggle('active', b === btn));
      stageEl.dataset['tool'] = tool;
    });
  });

  stageEl.querySelectorAll<HTMLElement>('.color-swatch').forEach((swatch) => {
    swatch.addEventListener('click', () => {
      color = swatch.dataset['color'] || '#2a2824';
      stageEl
        .querySelectorAll('.color-swatch')
        .forEach((s) => s.classList.toggle('active', s === swatch));
    });
  });

  btnClear?.addEventListener('click', () => {
    strokes = [];
    render();
  });

  // --- eraser ---

  function eraseAt(world: { x: number; y: number }): void {
    const r = 10 / cam.z;
    const before = strokes.length;
    strokes = strokes.filter(
      (s) =>
        !s.pts.some((p) => {
          const dx = p.x - world.x;
          const dy = p.y - world.y;
          return dx * dx + dy * dy < r * r;
        }),
    );
    if (strokes.length !== before) render();
  }

  // --- pointer helpers ---

  function getLocal(e: PointerEvent): { x: number; y: number; p: number } {
    const rect = canvasEl.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, p: e.pressure || 0.5 };
  }

  // --- pointer events ---

  canvasEl.addEventListener('pointerdown', (e: PointerEvent) => {
    canvasEl.setPointerCapture(e.pointerId);
    const loc = getLocal(e);
    const world = screenToWorld(cam, loc.x, loc.y);

    if (tool === 'hand' || e.button === 1 || e.shiftKey) {
      panStart = { x: loc.x, y: loc.y };
      camStart = { x: cam.x, y: cam.y };
      stageEl.classList.add('panning');
      return;
    }

    if (tool === 'eraser') {
      pressing = true;
      eraseAt(world);
      return;
    }

    pressing = true;
    current = { color, width: 2.5, pts: [{ x: world.x, y: world.y, p: loc.p }] };
    lastPoint = world;
  });

  canvasEl.addEventListener('pointermove', (e: PointerEvent) => {
    const loc = getLocal(e);

    if (panStart && camStart) {
      cam.x = camStart.x + (loc.x - panStart.x);
      cam.y = camStart.y + (loc.y - panStart.y);
      render();
      return;
    }

    if (!pressing) return;
    const world = screenToWorld(cam, loc.x, loc.y);

    if (tool === 'eraser') {
      eraseAt(world);
      return;
    }

    const dx = world.x - lastPoint.x;
    const dy = world.y - lastPoint.y;
    if (dx * dx + dy * dy < 2) return;

    current?.pts.push({ x: world.x, y: world.y, p: loc.p });
    lastPoint = world;
    render();
  });

  function endPress(): void {
    if (panStart) {
      panStart = null;
      camStart = null;
      stageEl.classList.remove('panning');
      return;
    }
    if (!pressing) return;
    pressing = false;
    if (current && current.pts.length) strokes.push(current);
    current = null;
    render();
  }

  canvasEl.addEventListener('pointerup', endPress);
  canvasEl.addEventListener('pointercancel', endPress);
  canvasEl.addEventListener('pointerleave', () => {
    if (panStart) endPress();
  });

  // --- wheel zoom ---

  canvas.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvasEl.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const before = screenToWorld(cam, sx, sy);
      const delta = -e.deltaY * 0.0015;
      cam.z = Math.min(3, Math.max(0.3, cam.z * (1 + delta)));
      const after = screenToWorld(cam, sx, sy);
      cam.x += (after.x - before.x) * cam.z;
      cam.y += (after.y - before.y) * cam.z;
      render();
    },
    { passive: false },
  );

  // --- keyboard shortcuts ---

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === 'p' || e.key === 'P') {
      stageEl.querySelector<HTMLElement>('.tool-btn[data-tool="pencil"]')?.click();
    } else if (e.key === 'h' || e.key === 'H') {
      stageEl.querySelector<HTMLElement>('.tool-btn[data-tool="hand"]')?.click();
    } else if (e.key === 'e' || e.key === 'E') {
      stageEl.querySelector<HTMLElement>('.tool-btn[data-tool="eraser"]')?.click();
    }
  });

  // --- embedded widget counter ---

  let count = 0;
  const counterBtn = document.getElementById('embed-counter-btn');
  const counterDisplay = document.getElementById('embed-count');
  counterBtn?.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    count++;
    if (counterDisplay) counterDisplay.textContent = count + ' clicks';
  });

  // --- seed a sample stroke ---

  const samplePoints: [number, number][] = [
    [100, 200],
    [130, 180],
    [170, 190],
    [210, 175],
    [245, 200],
  ];

  strokes.push({
    color: '#2d8bc3',
    width: 2.5,
    pts: samplePoints.map(([x, y], i) => ({ x, y, p: 0.5 + Math.sin(i) * 0.2 })),
  });

  resize();
}
