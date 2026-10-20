interface Paint {
  style: string;
  alpha: number;
}

/** A 2D context stub that records every stroke/fill style set and each rect's paint. */
export function recordingCanvas(): {
  ctx: CanvasRenderingContext2D;
  styles: string[];
  strokes: Paint[];
  fills: Paint[];
} {
  const styles: string[] = [];
  const strokes: Paint[] = [];
  const fills: Paint[] = [];
  let stroke = '';
  let fill = '';
  const noop = (): void => undefined;
  const ctx = {
    save: noop,
    restore: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    closePath: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    setLineDash: noop,
    lineWidth: 0,
    globalAlpha: 1,
    strokeRect(): void {
      strokes.push({ style: stroke, alpha: ctx.globalAlpha });
    },
    fillRect(): void {
      fills.push({ style: fill, alpha: ctx.globalAlpha });
    },
    set strokeStyle(v: string) {
      styles.push(v);
      stroke = v;
    },
    set fillStyle(v: string) {
      styles.push(v);
      fill = v;
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, styles, strokes, fills };
}
