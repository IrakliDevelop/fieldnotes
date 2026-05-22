export function pointerDown(
  el: HTMLElement,
  x: number,
  y: number,
  opts: PointerEventInit = {},
): void {
  el.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      clientX: x,
      clientY: y,
      button: 0,
      pointerId: 1,
      pressure: 0.5,
      ...opts,
    }),
  );
}

export function pointerMove(
  el: HTMLElement,
  x: number,
  y: number,
  opts: PointerEventInit = {},
): void {
  el.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pressure: 0.5,
      ...opts,
    }),
  );
}

export function pointerUp(
  el: HTMLElement,
  x: number,
  y: number,
  opts: PointerEventInit = {},
): void {
  el.dispatchEvent(
    new PointerEvent('pointerup', {
      bubbles: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      ...opts,
    }),
  );
}

export function drag(
  el: HTMLElement,
  from: [number, number],
  to: [number, number],
  steps = 5,
): void {
  pointerDown(el, from[0], from[1]);
  const dx = (to[0] - from[0]) / steps;
  const dy = (to[1] - from[1]) / steps;
  for (let i = 1; i <= steps; i++) {
    pointerMove(el, from[0] + dx * i, from[1] + dy * i);
  }
  pointerUp(el, to[0], to[1]);
}

export function tap(el: HTMLElement, x: number, y: number): void {
  pointerDown(el, x, y);
  pointerUp(el, x, y);
}

export function pinch(
  el: HTMLElement,
  center: [number, number],
  startDistance: number,
  endDistance: number,
  steps = 5,
): void {
  const [cx, cy] = center;
  const halfStart = startDistance / 2;

  pointerDown(el, cx - halfStart, cy, { pointerId: 1, pointerType: 'touch' });
  pointerDown(el, cx + halfStart, cy, { pointerId: 2, pointerType: 'touch' });

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const halfDist = halfStart + (endDistance / 2 - halfStart) * t;
    pointerMove(el, cx - halfDist, cy, { pointerId: 1, pointerType: 'touch' });
    pointerMove(el, cx + halfDist, cy, { pointerId: 2, pointerType: 'touch' });
  }

  const halfEnd = endDistance / 2;
  pointerUp(el, cx - halfEnd, cy, { pointerId: 1, pointerType: 'touch' });
  pointerUp(el, cx + halfEnd, cy, { pointerId: 2, pointerType: 'touch' });
}
