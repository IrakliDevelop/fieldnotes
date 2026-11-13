import type { HistoryRecorder } from '../history/history-recorder';

export interface InsertQueueDeps {
  recorder: HistoryRecorder;
  isGestureActive: () => boolean;
  flushPendingHistory: () => void;
  transaction: (run: () => void) => void;
}

/** Holds asynchronous inserts until no transaction or gesture is open, so each lands as its own undo step. */
export class InsertQueue {
  private readonly queue: (() => void)[] = [];
  private destroyed = false;
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: InsertQueueDeps) {
    // A gesture's transaction end fires before the gesture flag clears, so retry after it.
    this.unsubscribe = deps.recorder.onTransactionEnd(() => queueMicrotask(() => this.drain()));
  }

  /**
   * Runs `run` in its own transaction now when idle, else queues it until idle.
   * A drain that fires during `loadState` sees the paused recorder as idle only after
   * `loadState` returns, so queued inserts land on the new board.
   */
  insertWhenIdle(run: () => void): void {
    if (this.destroyed) return;
    this.deps.flushPendingHistory();
    if (this.idle()) this.deps.transaction(run);
    else this.queue.push(run);
  }

  destroy(): void {
    this.queue.length = 0;
    this.destroyed = true;
    this.unsubscribe();
  }

  private idle(): boolean {
    return this.deps.recorder.currentTransactionId === null && !this.deps.isGestureActive();
  }

  private drain(): void {
    while (!this.destroyed && this.idle()) {
      const run = this.queue.shift();
      if (!run) return;
      this.deps.transaction(run);
    }
  }
}
