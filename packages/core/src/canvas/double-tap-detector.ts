export interface DoubleTapDetectorOptions {
  timeout?: number;
  maxDistance?: number;
}

const DEFAULT_TIMEOUT = 300;
const DEFAULT_MAX_DISTANCE = 20;

export class DoubleTapDetector {
  private readonly timeout: number;
  private readonly maxDistance: number;
  private lastTapTime = 0;
  private lastTapX = 0;
  private lastTapY = 0;
  private hasPendingTap = false;

  constructor(options?: DoubleTapDetectorOptions) {
    this.timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    this.maxDistance = options?.maxDistance ?? DEFAULT_MAX_DISTANCE;
  }

  feed(e: PointerEvent): boolean {
    const now = Date.now();
    const x = e.clientX;
    const y = e.clientY;

    if (this.hasPendingTap) {
      const elapsed = now - this.lastTapTime;
      const dx = x - this.lastTapX;
      const dy = y - this.lastTapY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (elapsed <= this.timeout && dist <= this.maxDistance) {
        this.reset();
        return true;
      }
    }

    this.lastTapTime = now;
    this.lastTapX = x;
    this.lastTapY = y;
    this.hasPendingTap = true;
    return false;
  }

  reset(): void {
    this.hasPendingTap = false;
    this.lastTapTime = 0;
    this.lastTapX = 0;
    this.lastTapY = 0;
  }
}
