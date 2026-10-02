import type { AuthorityDriver, AuthorityPosition, AuthorityReadOptions } from './authority-types';
import type { HubFanout } from './hub-fanout';
import { isValidRoomName } from './room-name';
import { AuthorityScheduler } from './authority-scheduler';

const CLAIM_LIMITS = { entries: 64, bytes: 64 * 1024, leaseMs: 5000 } as const;

export interface AuthorityWake {
  readonly authority: 1;
  readonly room: string;
  readonly definitionId: string;
  readonly position: AuthorityPosition;
}

export function parseAuthorityWake(payload: string): AuthorityWake | null {
  if (Buffer.byteLength(payload, 'utf8') > 1024) return null;
  try {
    const value: unknown = JSON.parse(payload);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const position = record['position'];
    if (
      Object.keys(record).length !== 4 ||
      record['authority'] !== 1 ||
      !isValidRoomName(record['room']) ||
      typeof record['definitionId'] !== 'string' ||
      record['definitionId'].length === 0 ||
      record['definitionId'].length > 128 ||
      !position ||
      typeof position !== 'object' ||
      Array.isArray(position)
    )
      return null;
    const p = position as Record<string, unknown>;
    if (
      Object.keys(p).length !== 2 ||
      typeof p['generation'] !== 'string' ||
      typeof p['revision'] !== 'string' ||
      p['generation'].length > 128 ||
      p['revision'].length > 128 ||
      !p['generation'] ||
      !p['revision']
    )
      return null;
    return value as AuthorityWake;
  } catch {
    return null;
  }
}

/** One global claim worker: durable outbox work is independent of local room membership. */
export class AuthorityPublisher {
  private dirty = false;
  private running = false;
  private closed = false;
  private retryMs = 100;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly scheduler: AuthorityScheduler;
  private readonly ownsScheduler: boolean;

  constructor(
    private readonly driver: AuthorityDriver,
    private readonly fanout: HubFanout,
    private readonly ownerId: string,
    scheduler?: AuthorityScheduler,
  ) {
    this.scheduler = scheduler ?? new AuthorityScheduler();
    this.ownsScheduler = scheduler === undefined;
    this.wake();
  }

  wake(): void {
    if (this.closed) return;
    this.dirty = true;
    if (!this.running && !this.timer) this.scheduler.schedulePublisher(() => this.run());
  }

  private schedule(delay: number): void {
    if (this.closed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.wake();
    }, delay);
  }

  private async run(): Promise<void> {
    if (this.running || this.closed || !this.dirty) return;
    this.running = true;
    this.dirty = false;
    const controller = new AbortController();
    const deadlineAt = Date.now() + 5000;
    const timeout = setTimeout(() => controller.abort(), 5000);
    const options: AuthorityReadOptions = { deadlineAt, signal: controller.signal };
    try {
      const claims = await this.driver.claimPublications(this.ownerId, CLAIM_LIMITS, options);
      if (
        claims.length > CLAIM_LIMITS.entries ||
        Buffer.byteLength(JSON.stringify(claims), 'utf8') > CLAIM_LIMITS.bytes
      )
        throw new Error('Invalid authority claims');
      for (const claim of claims) {
        if (
          !isValidRoomName(claim.room) ||
          typeof claim.definitionId !== 'string' ||
          !claim.definitionId ||
          claim.definitionId.length > 128 ||
          claim.ownerId !== this.ownerId ||
          typeof claim.token !== 'string' ||
          !claim.token ||
          claim.token.length > 128 ||
          !claim.position ||
          typeof claim.position.generation !== 'string' ||
          !claim.position.generation ||
          claim.position.generation.length > 128 ||
          typeof claim.position.revision !== 'string' ||
          !claim.position.revision ||
          claim.position.revision.length > 128 ||
          !Number.isSafeInteger(claim.expiresAt)
        )
          throw new Error('Invalid authority claim');
        if (this.closed || controller.signal.aborted || Date.now() >= deadlineAt) break;
        const wake: AuthorityWake = {
          authority: 1,
          room: claim.room,
          definitionId: claim.definitionId,
          position: claim.position,
        };
        await this.fanout.publish(JSON.stringify(wake));
        if (this.closed || controller.signal.aborted || Date.now() >= deadlineAt) break;
        await this.driver.markPublished(claim, options);
      }
      this.retryMs = 100;
      this.schedule(claims.length === CLAIM_LIMITS.entries ? 0 : 1000);
    } catch {
      this.schedule(this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 1000);
    } finally {
      clearTimeout(timeout);
      this.running = false;
      if (this.dirty && !this.timer) this.scheduler.schedulePublisher(() => this.run());
    }
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.ownsScheduler) this.scheduler.close();
  }
}
