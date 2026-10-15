import { describe, expect, it, vi } from 'vitest';
import { AuthorityScheduler } from './authority-scheduler';

describe('bounded authority scheduler', () => {
  it('releases settled work before its captured callback and keeps coalesced pairs distinct', async () => {
    const scheduler = new AuthorityScheduler();
    const releasePeer = scheduler.admitPeer('peer', 'room', false);
    let finishFirst: (() => void) | undefined;
    const first = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    const firstAfter = vi.fn(() => {
      const release = scheduler.reserve('metadata');
      expect(release).toBeTypeOf('function');
      release?.();
    });
    const second = vi.fn(async () => undefined);
    const secondAfter = vi.fn();
    scheduler.schedule('peer', 'metadata', first, firstAfter);
    await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    scheduler.schedule('peer', 'metadata', second, secondAfter);
    expect(firstAfter).not.toHaveBeenCalled();
    finishFirst?.();
    await vi.waitFor(() => expect(secondAfter).toHaveBeenCalledTimes(1));
    expect(firstAfter).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    releasePeer?.();
    scheduler.close();
  });
  it('discards pending callbacks on removal and close, while isolating active callback throws', async () => {
    const scheduler = new AuthorityScheduler();
    const finish: (() => void)[] = [];
    const active = vi.fn(() => new Promise<void>((resolve) => finish.push(resolve)));
    const after = vi.fn(() => {
      throw new Error('callback fault');
    });
    const discarded = vi.fn();
    const releases = Array.from({ length: 9 }, (_, index) =>
      scheduler.admitPeer(`p${index}`, 'room', false),
    );
    for (let index = 0; index < 8; index++)
      scheduler.schedule(`p${index}`, 'metadata', active, after);
    await vi.waitFor(() => expect(active).toHaveBeenCalledTimes(8));
    scheduler.schedule('p8', 'metadata', active, discarded);
    releases[8]?.();
    finish.forEach((resolve) => resolve());
    await vi.waitFor(() => expect(after).toHaveBeenCalledTimes(8));
    expect(discarded).not.toHaveBeenCalled();
    expect(active).toHaveBeenCalledTimes(8);
    scheduler.close();
    releases.forEach((release) => release?.());
  });
  it('calls an active callback after retired peer ownership releases and drops queued work on close', async () => {
    const scheduler = new AuthorityScheduler();
    const released = vi.fn();
    const retire = scheduler.admitPeer('active', 'room', false, released);
    let finish: (() => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const after = vi.fn(() => expect(released).toHaveBeenCalledTimes(1));
    scheduler.schedule('active', 'metadata', run, after);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    retire?.();
    expect(released).not.toHaveBeenCalled();
    const occupied = Array.from({ length: 7 }, () => scheduler.reserve('metadata'));
    const queued = vi.fn();
    const queuedAfter = vi.fn();
    scheduler.admitPeer('queued', 'room', false);
    scheduler.schedule(
      'queued',
      'metadata',
      async () => {
        queued();
      },
      queuedAfter,
    );
    scheduler.close();
    occupied.forEach((release) => release?.());
    finish?.();
    await vi.waitFor(() => expect(after).toHaveBeenCalledTimes(1));
    expect(queued).not.toHaveBeenCalled();
    expect(queuedAfter).not.toHaveBeenCalled();
  });
  it('shares eight actual metadata slots with the global publisher across shutdown', async () => {
    const scheduler = new AuthorityScheduler();
    const finish: (() => void)[] = [];
    let active = 0;
    let peak = 0;
    const metadata = vi.fn(() => {
      active++;
      peak = Math.max(peak, active);
      return new Promise<void>((resolve) => {
        let released = false;
        finish.push(() => {
          if (released) return;
          released = true;
          active--;
          resolve();
        });
      });
    });
    for (let index = 0; index < 8; index++) {
      scheduler.admitPeer(`p${index}`, 'table', false);
      scheduler.schedule(`p${index}`, 'metadata', metadata);
    }
    await vi.waitFor(() => expect(metadata).toHaveBeenCalledTimes(8));
    scheduler.schedulePublisher(metadata);
    expect(peak).toBe(8);
    finish[0]?.();
    await vi.waitFor(() => expect(metadata).toHaveBeenCalledTimes(9));
    expect(peak).toBe(8);
    scheduler.close();
    expect(scheduler.reserve('metadata')).toBeNull();
    finish.forEach((release) => release());
    expect(active).toBe(0);
  });
  it('retains a canceled active peer and room until ignored-abort metadata settles', async () => {
    const scheduler = new AuthorityScheduler();
    const releases = Array.from({ length: 32 }, (_, index) =>
      scheduler.admitPeer(`p${index}`, `r${index}`, true),
    );
    const finish: (() => void)[] = [];
    const work = vi.fn(() => new Promise<void>((resolve) => finish.push(resolve)));
    for (let index = 0; index < 32; index++) scheduler.schedule(`p${index}`, 'metadata', work);
    await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(8));
    releases.forEach((release) => release?.());
    const replacement = scheduler.admitPeer('replacement', 'new', true);
    expect(replacement).toBeTypeOf('function');
    scheduler.schedule('replacement', 'metadata', work);
    expect(scheduler.reserve('metadata')).toBeNull();
    finish[0]?.();
    await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(9));
    replacement?.();
    finish.forEach((release) => release());
    scheduler.close();
  });
  it('keeps active heavy slots occupied after close and releases exactly once on late settlement', () => {
    const scheduler = new AuthorityScheduler();
    const first = scheduler.reserve('heavy');
    const second = scheduler.reserve('heavy');
    expect(first).toBeTypeOf('function');
    expect(second).toBeTypeOf('function');
    expect(scheduler.reserve('heavy')).toBeNull();
    scheduler.close();
    first?.();
    first?.();
    second?.();
    expect(scheduler.reserve('heavy')).toBeNull();
  });

  it('coalesces dirty peer work and limits prospective peers and active rooms', async () => {
    const scheduler = new AuthorityScheduler();
    const releases = Array.from({ length: 32 }, (_, index) =>
      scheduler.admitPeer(`p${index}`, `r${index}`, true),
    );
    expect(releases.every(Boolean)).toBe(true);
    expect(scheduler.admitPeer('overflow', 'new', true)).toBeNull();
    let releaseWork: (() => void) | undefined;
    const work = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseWork = resolve;
        }),
    );
    scheduler.schedule('p0', 'metadata', work);
    await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(1));
    scheduler.schedule('p0', 'metadata', work);
    scheduler.schedule('p0', 'metadata', work);
    expect(work).toHaveBeenCalledTimes(1);
    releaseWork?.();
    await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(2));
    releaseWork?.();
    releases.forEach((release) => release?.());
    scheduler.close();
  });

  it('keeps a waiting peer as one descriptor while ignored-abort heavy jobs occupy both slots', async () => {
    const scheduler = new AuthorityScheduler();
    for (const id of ['one', 'two', 'waiting'])
      expect(scheduler.admitPeer(id, 'table', false)).toBeTypeOf('function');
    let releaseOne: (() => void) | undefined;
    let releaseTwo: (() => void) | undefined;
    const first = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseOne = resolve;
        }),
    );
    const second = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseTwo = resolve;
        }),
    );
    const waiting = vi.fn(async () => undefined);
    scheduler.schedule('one', 'heavy', first);
    scheduler.schedule('two', 'heavy', second);
    scheduler.schedule('waiting', 'heavy', waiting);
    await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    expect(second).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 100; index++) scheduler.schedule('waiting', 'heavy', waiting);
    expect(waiting).not.toHaveBeenCalled();
    releaseOne?.();
    await vi.waitFor(() => expect(waiting).toHaveBeenCalledTimes(1));
    releaseTwo?.();
    scheduler.close();
  });
});
