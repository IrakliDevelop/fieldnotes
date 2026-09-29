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
    if (this.disposed || job.controller.signal.aborted || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    const now = Date.now();
    if (this.identity.expiresAt !== undefined && now >= this.identity.expiresAt) {
      this.close(4401);
      return false;
    }
    if (now >= job.deadlineAt) {
      this.close(1013);
      return false;
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
        if (this.identity.expiresAt !== undefined && Date.now() >= this.identity.expiresAt) {
          this.close(4401);
        } else {
          this.close(1013);
        }
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
      this.close(result === false ? 4403 : 1013);
    } catch {
      if (this.current(job)) this.close(1013);
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
    void this.outbound
      .enqueue(
        async () => {
          if (!(await this.authorize('outbound', message, job)) || !this.current(job)) return;
          await new Promise<void>((resolve) => {
            try {
              this.ws.send(message, (error) => {
                if (error && this.current(job)) this.close(1013);
                resolve();
              });
            } catch {
              if (this.current(job)) this.close(1013);
              resolve();
            }
          });
        },
        { signal: job.controller.signal, deadlineAt: job.deadlineAt },
      )
      .catch(() => {
        if (this.current(job)) this.close(1013);
      })
      .finally(() => this.finish(job));
  }

  /** Abort immediately; active hooks and send callbacks keep their reservations until settlement. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const job of this.jobs) {
      if (job.timer !== undefined) clearTimeout(job.timer);
      job.timer = undefined;
      job.controller.abort();
      // Queue abort unlinks a waiting payload synchronously. Its promise settles on a later
      // microtask; release that queued reservation now so close/leave fanout cannot see stale
      // capacity. A job that entered authorization or ws.send retains capacity until settlement.
      if (!job.started) this.finish(job);
    }
  }
}
