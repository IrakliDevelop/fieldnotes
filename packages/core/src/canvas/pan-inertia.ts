export interface PanInertiaDeps {
  pan: (dx: number, dy: number) => void;
  now: () => number;
  requestFrame: (cb: () => void) => number;
  cancelFrame: (id: number) => void;
  enabled: () => boolean;
}

// Only the last VELOCITY_WINDOW_MS of drag samples count toward release velocity,
// so a paused or slow finger at release does not produce a coast.
const VELOCITY_WINDOW_MS = 60;
const FRICTION = 0.92;
const MIN_START_SPEED = 2;
const MIN_STOP_SPEED = 0.3;

interface Sample {
  dx: number;
  dy: number;
  t: number;
}

export class PanInertia {
  private samples: Sample[] = [];
  private vx = 0;
  private vy = 0;
  private rafId: number | null = null;

  constructor(private readonly deps: PanInertiaDeps) {}

  sample(dx: number, dy: number): void {
    const t = this.deps.now();
    this.samples.push({ dx, dy, t });
    this.prune(t);
  }

  release(): void {
    if (!this.deps.enabled()) {
      this.reset();
      return;
    }
    const t = this.deps.now();
    this.prune(t);
    const recent = this.samples;
    if (recent.length === 0) {
      this.reset();
      return;
    }
    let sx = 0;
    let sy = 0;
    for (const s of recent) {
      sx += s.dx;
      sy += s.dy;
    }
    this.vx = sx / recent.length;
    this.vy = sy / recent.length;
    this.samples = [];
    if (Math.hypot(this.vx, this.vy) < MIN_START_SPEED) {
      this.vx = 0;
      this.vy = 0;
      return;
    }
    this.rafId = this.deps.requestFrame(this.step);
  }

  cancel(): void {
    this.reset();
  }

  private step = (): void => {
    if (this.rafId === null) return;
    this.deps.pan(this.vx, this.vy);
    this.vx *= FRICTION;
    this.vy *= FRICTION;
    if (Math.hypot(this.vx, this.vy) >= MIN_STOP_SPEED) {
      this.rafId = this.deps.requestFrame(this.step);
    } else {
      this.reset();
    }
  };

  private prune(now: number): void {
    const cutoff = now - VELOCITY_WINDOW_MS;
    this.samples = this.samples.filter((s) => s.t >= cutoff);
  }

  private reset(): void {
    if (this.rafId !== null) {
      this.deps.cancelFrame(this.rafId);
      this.rafId = null;
    }
    this.samples = [];
    this.vx = 0;
    this.vy = 0;
  }
}
