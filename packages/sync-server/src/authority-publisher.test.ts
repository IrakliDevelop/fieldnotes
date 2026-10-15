import { describe, expect, it, vi } from 'vitest';
import { AuthorityPublisher } from './authority-publisher';
import type { AuthorityDriver, AuthorityPublicationClaim } from './authority-types';
import type { HubFanout } from './hub-fanout';
import { createAuthorityOperationId } from '@fieldnotes/sync';
import { prepareAuthorityProposal } from './authority-proposal';
import { prepareAuthorityIntent } from './authority-intent';
import { AuthorityFixtureDriver, AuthorityFixtureStore } from './test-support/authority-driver';

const claim: AuthorityPublicationClaim = {
  room: 'table',
  definitionId: 'definition',
  position: { generation: 'g', revision: 'private-position' },
  ownerId: 'worker',
  token: 'fence',
  expiresAt: Date.now() + 5000,
};

describe('global authority publisher', () => {
  it('recovers a committed outbox entry after hub restart with no connected peers', async () => {
    const store = new AuthorityFixtureStore();
    store.now = Date.now();
    store.provision('table');
    const original = new AuthorityFixtureDriver(store);
    const prepared = prepareAuthorityProposal(
      {
        room: 'table',
        actorId: 'actor',
        connectionId: 'old-hub',
        deadlineAt: Date.now() + 5000,
        signal: new AbortController().signal,
      },
      JSON.stringify({
        protocol: 'authority:1',
        kind: 'propose',
        generation: 'g',
        clientOperationId: createAuthorityOperationId(store.now),
        mutation: {
          kind: 'upsert',
          element: {
            id: 'shape',
            type: 'shape',
            position: { x: 0, y: 0 },
            zIndex: 0,
            locked: false,
            layerId: 'layer',
            shape: 'rectangle',
            size: { w: 1, h: 1 },
            strokeColor: 'red',
            strokeWidth: 1,
            fillColor: 'blue',
          },
        },
      }),
    );
    expect(
      (
        await original.commit(
          { ...prepared.context, ownershipId: 'owner', definitionId: 'definition' },
          { proposal: prepared.proposal, intent: prepareAuthorityIntent(prepared.proposal) },
        )
      ).status,
    ).toBe('committed');
    const publish = vi.fn(async (_payload: string) => undefined);
    const publisher = new AuthorityPublisher(
      new AuthorityFixtureDriver(store),
      { publish, subscribe: () => () => undefined },
      'new-worker',
    );
    try {
      await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
      const message = JSON.parse(publish.mock.calls[0]?.[0] ?? '{}');
      expect(message).toMatchObject({ authority: 1, room: 'table', definitionId: 'definition' });
      expect(JSON.stringify(message)).not.toContain('shape');
      await vi.waitFor(() => expect(store.getRoom('table')?.entries[0]?.published).toBe(true));
    } finally {
      publisher.close();
    }
  });
  it('claims durable work without a connected room and marks only after fanout settles', async () => {
    let releasePublish: (() => void) | undefined;
    const publish = vi.fn(
      (_payload: string) =>
        new Promise<void>((resolve) => {
          releasePublish = resolve;
        }),
    );
    const markPublished = vi.fn(async () => undefined);
    const claimPublications = vi.fn().mockResolvedValueOnce([claim]).mockResolvedValue([]);
    const driver = { claimPublications, markPublished } as unknown as AuthorityDriver;
    const fanout: HubFanout = { publish, subscribe: () => () => undefined };
    const publisher = new AuthorityPublisher(driver, fanout, 'worker');
    try {
      publisher.wake();
      await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
      expect(markPublished).not.toHaveBeenCalled();
      expect(publish.mock.calls[0]?.[0]).toContain('private-position');
      expect(publish.mock.calls[0]?.[0]).not.toContain('receipt');
      releasePublish?.();
      await vi.waitFor(() => expect(markPublished).toHaveBeenCalledWith(claim, expect.anything()));
    } finally {
      publisher.close();
    }
  });

  it('retries a failed publish without marking and coalesces repeated wakeups', async () => {
    const publish = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(undefined);
    const markPublished = vi.fn(async () => undefined);
    const claimPublications = vi.fn().mockResolvedValue([claim]);
    const driver = { claimPublications, markPublished } as unknown as AuthorityDriver;
    const publisher = new AuthorityPublisher(
      driver,
      { publish, subscribe: () => () => undefined },
      'worker',
    );
    try {
      for (let index = 0; index < 100; index++) publisher.wake();
      await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
      expect(markPublished).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(markPublished).toHaveBeenCalledTimes(1), { timeout: 1000 });
      expect(claimPublications.mock.calls.length).toBeLessThan(10);
    } finally {
      publisher.close();
    }
  });

  it('retains its single worker until an ignored-abort claim settles after shutdown', async () => {
    let finishClaim: ((claims: readonly AuthorityPublicationClaim[]) => void) | undefined;
    const claimPublications = vi.fn(
      () =>
        new Promise<readonly AuthorityPublicationClaim[]>((resolve) => {
          finishClaim = resolve;
        }),
    );
    const publish = vi.fn();
    const driver = { claimPublications, markPublished: vi.fn() } as unknown as AuthorityDriver;
    const publisher = new AuthorityPublisher(
      driver,
      { publish, subscribe: () => () => undefined },
      'worker',
    );
    await vi.waitFor(() => expect(claimPublications).toHaveBeenCalledTimes(1));
    publisher.close();
    publisher.wake();
    expect(claimPublications).toHaveBeenCalledTimes(1);
    finishClaim?.([claim]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(publish).not.toHaveBeenCalled();
  });
});
