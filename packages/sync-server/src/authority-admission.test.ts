import { describe, expect, it, vi } from 'vitest';
import { createAuthorityCapabilities } from '@fieldnotes/sync';
import {
  authorityCapabilitiesMatch,
  pinAuthorityDefinition,
  resolveAuthorityDefinition,
  resolveAuthorityIdentity,
} from './authority-admission';
import { createSyncServer } from './create-sync-server';
import type { AuthorityOptions, AuthorityRoomDefinition } from './authority-types';
import type { Connection } from './sync-hub';

const definition: AuthorityRoomDefinition = {
  id: 'table-v1',
  extensions: [
    {
      requirement: { key: 'synthetic', pluginName: 'test', version: 1, validate: () => true },
      extensionKinds: ['test-op'],
      prepare: () => null,
      changes: () => [],
    },
  ],
  project: (_context, state) => state,
  canReadOwnerId: () => false,
};

describe('authority admission', () => {
  it('pins an exact extension inventory and rejects changed or absent peer declarations', () => {
    const pinned = pinAuthorityDefinition(definition);
    expect(Object.isFrozen(pinned.extensions)).toBe(true);
    expect(
      authorityCapabilitiesMatch(
        createAuthorityCapabilities(
          ['test-op'],
          [{ key: 'synthetic', pluginName: 'test', version: 1 }],
        ),
        pinned,
      ),
    ).toBe(true);
    expect(authorityCapabilitiesMatch(createAuthorityCapabilities(['test-op']), pinned)).toBe(
      false,
    );
    const extension = definition.extensions[0];
    if (!extension) throw new Error('missing test extension');
    expect(() =>
      pinAuthorityDefinition({
        ...definition,
        extensions: [...definition.extensions, extension],
      }),
    ).toThrow();
    expect(() =>
      pinAuthorityDefinition({
        ...definition,
        extensions: [{ ...extension, requirement: { ...extension.requirement, version: 0 } }],
      }),
    ).toThrow();
  });

  it('copies stable resolver identity and rejects invalid UTF-8 or connection fallback', () => {
    const identity = { actorId: 'account-1', ownershipId: 'owner-1' };
    const resolver = vi.fn(() => identity);
    const options = { resolveIdentity: resolver } as unknown as AuthorityOptions;
    const connection = { id: 'socket-1', room: 'table' } as Connection;
    const admitted = resolveAuthorityIdentity(options, connection);
    identity.actorId = 'changed';
    expect(admitted.actorId).toBe('account-1');
    expect(options.resolveIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'socket-1', room: 'table' }),
    );
    resolver.mockReturnValue({ actorId: '\ud800', ownershipId: 'owner-1' });
    expect(() => resolveAuthorityIdentity(options, connection)).toThrow();
  });

  it('fails closed on resolver faults and requires guarded factory authority', async () => {
    const options = {
      driver: {},
      resolveRoom: () => {
        throw new Error('private');
      },
      resolveIdentity: () => ({ actorId: 'actor', ownershipId: 'owner' }),
    } as unknown as AuthorityOptions;
    expect(() => resolveAuthorityDefinition(options, 'table')).toThrow();
    expect(() => createSyncServer({ authority: options })).toThrow(
      'requires framePolicy and authenticate',
    );
    const server = createSyncServer({
      authority: options,
      framePolicy: {},
      authenticate: async () => ({ userId: 'actor' }),
    });
    await server.close();
  });
});
