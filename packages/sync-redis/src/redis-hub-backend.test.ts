import { describe, it, expect } from 'vitest';
import { createShape } from '@fieldnotes/core';
import type { CanvasElement } from '@fieldnotes/core';
import { RedisHubBackend, type RedisHashClient } from './index';

class FakeRedis implements RedisHashClient {
  store = new Map<string, Map<string, string>>();
  private hash(key: string): Map<string, string> {
    let m = this.store.get(key);
    if (!m) {
      m = new Map();
      this.store.set(key, m);
    }
    return m;
  }
  async hGetAll(key: string): Promise<Record<string, string>> {
    const m = this.store.get(key);
    return m ? Object.fromEntries(m) : {};
  }
  async hGet(key: string, field: string): Promise<string | null> {
    return this.store.get(key)?.get(field) ?? null;
  }
  async hSet(key: string, field: string, value: string): Promise<number> {
    this.hash(key).set(field, value);
    return 1;
  }
  async hDel(key: string, field: string): Promise<number> {
    this.store.get(key)?.delete(field);
    return 1;
  }
  async del(key: string): Promise<number> {
    this.store.delete(key);
    return 1;
  }
}

function element(id: string, x = 0): CanvasElement {
  return { ...createShape({ position: { x, y: 0 }, size: { w: 10, h: 10 } }), id };
}

describe('RedisHubBackend', () => {
  it('round-trips upsert/update/remove/clear', async () => {
    const fake = new FakeRedis();
    const b = new RedisHubBackend(fake);

    await b.apply('R', { kind: 'upsert', element: element('e1', 1) });
    let snap = await b.snapshot('R');
    expect(snap).toHaveLength(1);
    expect(snap[0]?.id).toBe('e1');
    expect(snap[0]?.position.x).toBe(1);

    await b.apply('R', { kind: 'upsert', element: element('e1', 99) });
    snap = await b.snapshot('R');
    expect(snap).toHaveLength(1);
    expect(snap[0]?.position.x).toBe(99);

    await b.apply('R', { kind: 'remove', id: 'e1' });
    expect(await b.snapshot('R')).toHaveLength(0);

    await b.apply('R', { kind: 'upsert', element: element('e1') });
    await b.apply('R', { kind: 'upsert', element: element('e2') });
    await b.apply('R', { kind: 'clear' });
    expect(await b.snapshot('R')).toHaveLength(0);
  });

  it('persists room state across backend instances (restart)', async () => {
    const fake = new FakeRedis();
    const b1 = new RedisHubBackend(fake);
    await b1.apply('R', { kind: 'upsert', element: element('e1') });
    await b1.apply('R', { kind: 'upsert', element: element('e2') });

    const b2 = new RedisHubBackend(fake);
    const snap = await b2.snapshot('R');
    expect(snap.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('isolates state by keyPrefix', async () => {
    const fake = new FakeRedis();
    const a = new RedisHubBackend(fake, { keyPrefix: 'a:' });
    const b = new RedisHubBackend(fake, { keyPrefix: 'b:' });
    await a.apply('R', { kind: 'upsert', element: element('e1') });
    expect(await b.snapshot('R')).toHaveLength(0);
    expect(await a.snapshot('R')).toHaveLength(1);
  });

  it('isolates state by room', async () => {
    const fake = new FakeRedis();
    const b = new RedisHubBackend(fake);
    await b.apply('R', { kind: 'upsert', element: element('e1') });
    expect(await b.snapshot('R2')).toHaveLength(0);
  });

  describe('get', () => {
    it('returns the stored element after apply', async () => {
      const fake = new FakeRedis();
      const b = new RedisHubBackend(fake);
      await b.apply('R', { kind: 'upsert', element: element('e1', 5) });
      const got = await b.get('R', 'e1');
      expect(got?.id).toBe('e1');
      expect(got?.position.x).toBe(5);
    });

    it('returns undefined for an absent element', async () => {
      const fake = new FakeRedis();
      const b = new RedisHubBackend(fake);
      expect(await b.get('R', 'missing')).toBeUndefined();
    });

    it('returns undefined for a corrupt stored value without throwing', async () => {
      const fake = new FakeRedis();
      const b = new RedisHubBackend(fake);
      await fake.hSet('fieldnotes:room:R', 'bad', 'not json{');
      expect(await b.get('R', 'bad')).toBeUndefined();
    });
  });

  it('filters malformed stored values without throwing', async () => {
    const fake = new FakeRedis();
    const b = new RedisHubBackend(fake);
    await b.apply('R', { kind: 'upsert', element: element('good') });
    await fake.hSet('fieldnotes:room:R', 'bad', 'not json{');
    await fake.hSet('fieldnotes:room:R', 'noid', JSON.stringify({ type: 'shape' }));

    const snap = await b.snapshot('R');
    expect(snap).toHaveLength(1);
    expect(snap[0]?.id).toBe('good');
  });
});
