import { WebSocket } from 'ws';
import type { AuthContext } from './auth-context';
import type { FramePolicy, FrameAuthorizationContext } from './frame-policy';
import { FRAME_TIMEOUT_MS, type FrameBudget } from './bounded-frame-queue';
import { SerialRoomQueue } from './serial-room-queue';
import type { SyncHub } from './sync-hub';

interface AdmittedIdentity {
  readonly connectionId: string;
  readonly room: string;
  readonly userId?: string;
  readonly role?: string;
  readonly authContext?: AuthContext;
  readonly expiresAt?: number;
}

interface Job {
  readonly controller: AbortController;
  readonly release: () => void;
  readonly deadlineAt: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  started: boolean;
  settle?: (delivered: boolean) => void;
}

/** Internal authority accounting: caller completion can precede physical settlement. */
export interface AuthorityTrackedSend {
  readonly completion: Promise<void>;
  readonly settled: Promise<void>;
}

function deliveryFailure(): Error {
  return new Error('frame delivery failed');
}

/** One admitted socket's guarded frames. Inbound uses the hub's room queue directly. */
export class FrameTransport {
  private readonly jobs = new Set<Job>();
  private readonly outbound = new SerialRoomQueue(() => undefined);
  private disposed = false;

  constructor(
    private readonly ws: WebSocket,
    private readonly hub: SyncHub,
    private readonly identity: AdmittedIdentity,
    private readonly policy: FramePolicy,
    private readonly budget: FrameBudget,
    private readonly close: (code: 4401 | 4403 | 1013) => void,
  ) {}

  private current(job: Job): boolean {
    if (this.disposed || job.controller.signal.aborted) return false;
    if (this.ws.readyState !== WebSocket.OPEN) return this.invalidate(job, 1013);
    const now = Date.now();
    if (this.identity.expiresAt !== undefined && now >= this.identity.expiresAt) {
      return this.invalidate(job, 4401);
    }
    if (now >= job.deadlineAt) {
      return this.invalidate(job, 1013);
    }
    return true;
  }

  private admit(message: string): Job | null {
    const release = this.budget.reserve(this.identity.connectionId, this.identity.room, message);
    if (!release) {
      this.close(1013);
      return null;
    }
    const deadlineAt = Math.min(Date.now() + FRAME_TIMEOUT_MS, this.identity.expiresAt ?? Infinity);
    const controller = new AbortController();
    const job: Job = { controller, release, deadlineAt, timer: undefined, started: false };
    this.jobs.add(job);
    job.timer = setTimeout(
      () => {
        this.invalidate(
          job,
          this.identity.expiresAt !== undefined && Date.now() >= this.identity.expiresAt
            ? 4401
            : 1013,
        );
      },
      Math.max(0, deadlineAt - Date.now()),
    );
    return job;
  }

  private finish(job: Job): void {
    if (!this.jobs.delete(job)) return;
    if (job.timer !== undefined) clearTimeout(job.timer);
    job.controller.abort();
    job.release();
  }

  /** Caller failure precedes close; active work retains its queue slot and reservation. */
  private invalidate(job: Job, code: 4401 | 4403 | 1013): false {
    job.settle?.(false);
    job.controller.abort();
    if (!job.started) this.finish(job);
    this.close(code);
    return false;
  }

  private async authorize(
    direction: 'inbound' | 'outbound',
    message: string,
    job: Job,
  ): Promise<boolean> {
    job.started = true;
    if (!this.current(job)) return false;
    const context: FrameAuthorizationContext = Object.freeze({
      ...this.identity,
      direction,
      message,
      deadlineAt: job.deadlineAt,
      signal: job.controller.signal,
    });
    try {
      const result = this.policy.authorize ? await this.policy.authorize(context) : true;
      if (!this.current(job)) return false;
      if (result === true) return true;
      this.invalidate(job, result === false ? 4403 : 1013);
    } catch {
      if (this.current(job)) this.invalidate(job, 1013);
    }
    return false;
  }

  receive(message: string): void {
    if (this.disposed) return;
    const job = this.admit(message);
    if (!job) return;
    void this.hub
      .handleMessage(this.identity.connectionId, message, {
        deadlineAt: job.deadlineAt,
        signal: job.controller.signal,
        beforeProcess: () => this.authorize('inbound', message, job),
      })
      .catch(() => {
        if (this.current(job)) this.close(1013);
      })
      .finally(() => this.finish(job));
  }

  /** Synchronous admission; accepted delivery continues on this socket's independent FIFO. */
  send(message: string): void {
    if (this.disposed) return;
    const job = this.admit(message);
    if (!job) throw new Error('frame admission failed');
    void this.enqueueOutbound(message, job).completion.catch(() => undefined);
  }

  /** Resolves only after this guarded socket's local WebSocket send callback succeeds. */
  sendAsync(message: string): Promise<void> {
    return this.sendTracked(message).completion;
  }

  /** Kept package-internal through the guarded connection binding. */
  sendTracked(message: string): AuthorityTrackedSend {
    if (this.disposed)
      return { completion: Promise.reject(deliveryFailure()), settled: Promise.resolve() };
    const job = this.admit(message);
    if (!job) return { completion: Promise.reject(deliveryFailure()), settled: Promise.resolve() };
    return this.enqueueOutbound(message, job);
  }

  private enqueueOutbound(message: string, job: Job): AuthorityTrackedSend {
    let resolveSettled: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const completion = new Promise<void>((resolve, reject) => {
      job.settle = (delivered) => {
        job.settle = undefined;
        if (delivered) resolve();
        else reject(deliveryFailure());
      };
    });
    void this.outbound
      .enqueue(
        async () => {
          if (!(await this.authorize('outbound', message, job)) || !this.current(job)) return;
          await new Promise<void>((resolve) => {
            let observed = false;
            const complete = (error?: Error) => {
              if (observed) return;
              observed = true;
              if (error) {
                if (this.current(job)) this.invalidate(job, 1013);
              } else if (this.current(job)) {
                // Release before waking the caller, so its next frame can be admitted.
                this.finish(job);
                job.settle?.(true);
              }
              resolve();
            };
            try {
              this.ws.send(message, complete);
            } catch {
              complete(deliveryFailure());
            }
          });
        },
        { signal: job.controller.signal, deadlineAt: job.deadlineAt },
      )
      .catch(() => {
        if (this.current(job)) this.invalidate(job, 1013);
      })
      .finally(() => {
        // SerialRoomQueue also resolves canceled/skipped entries; that is never delivery.
        job.settle?.(false);
        this.finish(job);
        resolveSettled();
      });
    return { completion, settled };
  }

  /** Abort immediately; active hooks and send callbacks keep their reservations until settlement. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const job of this.jobs) {
      if (job.timer !== undefined) clearTimeout(job.timer);
      job.timer = undefined;
      job.settle?.(false);
      job.controller.abort();
      // Queue abort unlinks a waiting payload synchronously. Its promise settles on a later
      // microtask; release that queued reservation now so close/leave fanout cannot see stale
      // capacity. A job that entered authorization or ws.send retains capacity until settlement.
      if (!job.started) this.finish(job);
    }
  }
}
