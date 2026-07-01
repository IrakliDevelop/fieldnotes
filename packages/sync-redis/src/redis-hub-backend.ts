import { isValidElement, type SyncOp } from '@fieldnotes/sync';
import type { CanvasElement } from '@fieldnotes/core';
import type { HubBackend } from '@fieldnotes/sync-server';
import type { RedisHashClient } from './redis-hash-client';

export interface RedisHubBackendOptions {
  keyPrefix?: string; // default 'fieldnotes:room:'
}

export class RedisHubBackend implements HubBackend {
  private readonly client: RedisHashClient;
  private readonly keyPrefix: string;

  constructor(client: RedisHashClient, options: RedisHubBackendOptions = {}) {
    this.client = client;
    this.keyPrefix = options.keyPrefix ?? 'fieldnotes:room:';
  }

  private key(room: string): string {
    return `${this.keyPrefix}${room}`;
  }

  async snapshot(room: string): Promise<CanvasElement[]> {
    const map = await this.client.hGetAll(this.key(room));
    const out: CanvasElement[] = [];
    for (const value of Object.values(map)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        continue; // skip a corrupt stored value rather than throwing the whole snapshot
      }
      if (isValidElement(parsed)) out.push(parsed);
    }
    return out;
  }

  async apply(room: string, op: SyncOp): Promise<void> {
    const key = this.key(room);
    if (op.kind === 'upsert')
      await this.client.hSet(key, op.element.id, JSON.stringify(op.element));
    else if (op.kind === 'remove') await this.client.hDel(key, op.id);
    else if (op.kind === 'clear') await this.client.del(key);
    // request-snapshot/snapshot never reach apply (the hub only applies data ops)
  }
}
