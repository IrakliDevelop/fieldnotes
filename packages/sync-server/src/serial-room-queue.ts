interface Entry {
  run: (() => Promise<void> | void) | undefined;
  resolve: () => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  deadlineAt?: number;
  onAbort?: () => void;
  active: boolean;
}

/** A serial queue whose queued jobs can be unlinked without waiting for a hung head. */
export class SerialRoomQueue {
  private readonly entries: Entry[] = [];
  private active: Entry | undefined;

  constructor(private readonly onIdle: () => void) {}

  get idle(): boolean {
    return !this.active && this.entries.length === 0;
  }

  enqueue(
    run: () => Promise<void> | void,
    options?: { readonly signal: AbortSignal; readonly deadlineAt: number },
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const entry: Entry = {
        run,
        resolve,
        reject,
        signal: options?.signal,
        deadlineAt: options?.deadlineAt,
        active: false,
      };
      const cancel = () => {
        if (entry.active) return;
        const index = this.entries.indexOf(entry);
        if (index >= 0) this.entries.splice(index, 1);
        entry.run = undefined;
        entry.signal?.removeEventListener('abort', cancel);
        resolve();
        if (this.idle) this.onIdle();
      };
      entry.onAbort = cancel;
      if (options?.signal.aborted || (options && Date.now() >= options.deadlineAt)) {
        entry.run = undefined;
        resolve();
        if (this.idle) this.onIdle();
        return;
      }
      options?.signal.addEventListener('abort', cancel, { once: true });
      this.entries.push(entry);
      this.pump();
    });
  }

  private pump(): void {
    if (this.active) return;
    const entry = this.entries.shift();
    if (!entry) {
      this.onIdle();
      return;
    }
    entry.active = true;
    this.active = entry;
    entry.signal?.removeEventListener('abort', entry.onAbort ?? (() => undefined));
    if (
      entry.signal?.aborted ||
      (entry.deadlineAt !== undefined && Date.now() >= entry.deadlineAt)
    ) {
      entry.run = undefined;
      entry.resolve();
      this.active = undefined;
      this.pump();
      return;
    }
    const run = entry.run;
    entry.run = undefined;
    // Promise.resolve().then captures synchronous exceptions while retaining this active
    // slot until the real operation, including a non-cooperative one, actually settles.
    void Promise.resolve()
      .then(run)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        this.active = undefined;
        this.pump();
      });
  }
}
