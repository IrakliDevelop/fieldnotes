const SAMPLE_SIZE = 60;

export interface RenderStatsSnapshot {
  fps: number;
  avgFrameMs: number;
  p95FrameMs: number;
  lastFrameMs: number;
  lastGridMs: number;
  frameCount: number;
}

export class RenderStats {
  private frameTimes: number[] = [];
  private frameCount = 0;
  private _lastGridMs = 0;

  recordFrame(durationMs: number, gridMs?: number): void {
    this.frameCount++;
    this.frameTimes.push(durationMs);
    if (this.frameTimes.length > SAMPLE_SIZE) {
      this.frameTimes.shift();
    }
    if (gridMs !== undefined) this._lastGridMs = gridMs;
  }

  getSnapshot(): RenderStatsSnapshot {
    const times = this.frameTimes;
    if (times.length === 0) {
      return { fps: 0, avgFrameMs: 0, p95FrameMs: 0, lastFrameMs: 0, lastGridMs: 0, frameCount: 0 };
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const sorted = [...times].sort((a, b) => a - b);
    const p95Index = Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1);
    const lastFrame = times[times.length - 1] ?? 0;

    return {
      fps: avg > 0 ? Math.round(1000 / avg) : 0,
      avgFrameMs: Math.round(avg * 100) / 100,
      p95FrameMs: Math.round((sorted[p95Index] ?? 0) * 100) / 100,
      lastFrameMs: Math.round(lastFrame * 100) / 100,
      lastGridMs: Math.round(this._lastGridMs * 100) / 100,
      frameCount: this.frameCount,
    };
  }

  reset(): void {
    this.frameTimes = [];
    this.frameCount = 0;
  }
}
