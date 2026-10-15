import { describe, expect, it } from 'vitest';
import { createAuthorityOperationId } from '@fieldnotes/sync';
import { prepareAuthorityCheckpoint } from '@fieldnotes/sync';
import type { AuthorityMutation } from '@fieldnotes/sync';
import { prepareAuthorityProposal } from './authority-proposal';
import { prepareAuthorityIntent } from './authority-intent';
import type {
  AuthorityCommitContext,
  AuthorityCommitRequest,
  AuthorityExtension,
  AuthorityReadContext,
  AuthorityReadOptions,
} from './authority-types';
import { AuthorityFixtureDriver, AuthorityFixtureStore } from './test-support/authority-driver';

const element = (id: string, ownerId?: string) => ({
  id,
  type: 'shape' as const,
  position: { x: 0, y: 0 },
  zIndex: 0,
  locked: false,
  layerId: 'layer',
  shape: 'rectangle' as const,
  size: { w: 1, h: 1 },
  strokeColor: 'red',
  strokeWidth: 1,
  fillColor: 'blue',
  ...(ownerId === undefined ? {} : { ownerId }),
});

function setup() {
  const store = new AuthorityFixtureStore();
  store.provision('room');
  const driver = new AuthorityFixtureDriver(store);
  const options = (): AuthorityReadOptions => ({
    deadlineAt: Date.now() + 60_000,
    signal: new AbortController().signal,
  });
  const read = (actorId = 'actor'): AuthorityReadContext => ({
    room: 'room',
    actorId,
    ownershipId: actorId,
    connectionId: 'socket',
    definitionId: 'definition',
    ...options(),
  });
  const request = (
    mutation: AuthorityMutation,
    issuedAt: number,
    expectedState?: string,
    actorId = 'actor',
    operationId = createAuthorityOperationId(issuedAt),
    extensions: readonly AuthorityExtension[] = [],
  ) => {
    const prepared = prepareAuthorityProposal(
      { ...read(actorId) },
      JSON.stringify({
        protocol: 'authority:1',
        kind: 'propose',
        generation: 'g',
        clientOperationId: operationId,
        mutation,
        ...(expectedState === undefined ? {} : { expectedState }),
      }),
    );
    const context: AuthorityCommitContext = {
      ...prepared.context,
      ownershipId: actorId,
      definitionId: 'definition',
    };
    const commitRequest: AuthorityCommitRequest = {
      proposal: prepared.proposal,
      intent: prepareAuthorityIntent(prepared.proposal, extensions),
    };
    return { context, commitRequest };
  };
  return { store, driver, read, options, request };
}

describe('transactional authority driver conformance fixture', () => {
  it('recovers retained duplicate clear after the room CAS changes', async () => {
    const { store, driver, request, read, options } = setup();
    store.policy.canClear = () => true;
    store.policy.canCaptureCas = () => true;
    const first = request({ kind: 'upsert', element: element('e') }, store.now);
    expect((await driver.commit(first.context, first.commitRequest)).status).toBe('committed');
    const capture = await driver.checkpoint(read(), options());
    const clear = request({ kind: 'clear' }, store.now + 1, capture.casToken);
    const accepted = await driver.commit(clear.context, clear.commitRequest);
    expect(accepted.status).toBe('committed');
    const later = request({ kind: 'upsert', element: element('f') }, store.now + 2);
    expect((await driver.commit(later.context, later.commitRequest)).status).toBe('committed');
    const replay = await new AuthorityFixtureDriver(store).commit(
      clear.context,
      clear.commitRequest,
    );
    expect(replay).toEqual({ ...accepted, replayed: true });
    expect(store.getRoom('room')?.state.elements.map((item) => item.id)).toEqual(['f']);
    await capture.release();
  });

  it('advances the persistent retry floor before applying a count-evicted unknown ID', async () => {
    const { store, driver, request } = setup();
    store.maxDedupeEntries = 2;
    const old = request({ kind: 'upsert', element: element('old') }, store.now);
    const next = request({ kind: 'upsert', element: element('next') }, store.now + 1);
    const newest = request({ kind: 'upsert', element: element('newest') }, store.now + 2);
    for (const item of [old, next])
      expect((await driver.commit(item.context, item.commitRequest)).status).toBe('committed');
    const sameTimestampUnknown = request(
      { kind: 'upsert', element: element('must-not-apply') },
      store.now,
    );
    const beforePosition = store.getRoom('room')?.position;
    expect(
      await driver.commit(sameTimestampUnknown.context, sameTimestampUnknown.commitRequest),
    ).toEqual({
      status: 'rejected',
      reason: 'retry-window-expired',
    });
    expect(store.getRoom('room')?.position).toEqual(beforePosition);
    expect(store.getRoom('room')?.retiredIssuedAtFloor).toBe(0);
    expect((await driver.commit(newest.context, newest.commitRequest)).status).toBe('committed');
    const unknownAtFloor = request(
      { kind: 'upsert', element: element('must-not-apply') },
      store.now,
    );
    expect(await driver.commit(unknownAtFloor.context, unknownAtFloor.commitRequest)).toEqual({
      status: 'rejected',
      reason: 'retry-window-expired',
    });
    expect(await driver.commit(old.context, old.commitRequest)).toEqual({
      status: 'rejected',
      reason: 'retry-window-expired',
    });
    expect(store.getRoom('room')?.retiredIssuedAtFloor).toBe(store.now);
    expect(store.getRoom('room')?.state.elements.map((item) => item.id)).toEqual([
      'newest',
      'next',
      'old',
    ]);
  });

  it('keeps a committed receipt across an unknown lost response and rejects a changed digest', async () => {
    const { store, driver, request } = setup();
    const original = request({ kind: 'upsert', element: element('e') }, store.now);
    store.loseCommitResponse = true;
    await expect(driver.commit(original.context, original.commitRequest)).rejects.toThrow(
      'lost commit response',
    );
    store.loseCommitResponse = false;
    const replay = await new AuthorityFixtureDriver(store).commit(
      original.context,
      original.commitRequest,
    );
    expect(replay).toMatchObject({ status: 'committed', replayed: true });
    const changed = request(
      { kind: 'upsert', element: element('other') },
      store.now,
      undefined,
      'actor',
      original.context.clientOperationId,
    );
    expect(await driver.commit(changed.context, changed.commitRequest)).toEqual({
      status: 'rejected',
      reason: 'operation-id-reused',
    });
    expect(store.getRoom('room')?.entries).toHaveLength(1);
  });

  it('keeps owner identity after removal and fails a rejected new operation atomically', async () => {
    const { store, driver, request } = setup();
    const create = request({ kind: 'upsert', element: element('e', 'fake') }, store.now);
    await driver.commit(create.context, create.commitRequest);
    expect(store.getRoom('room')?.state.elements[0]?.ownerId).toBe('actor');
    const remove = request({ kind: 'remove', id: 'e' }, store.now + 1);
    await driver.commit(remove.context, remove.commitRequest);
    const other = request(
      { kind: 'upsert', element: element('e') },
      store.now + 2,
      undefined,
      'other',
    );
    const position = store.getRoom('room')?.position;
    const count = store.getRoom('room')?.entries.length;
    expect(await driver.commit(other.context, other.commitRequest)).toEqual({
      status: 'rejected',
      reason: 'forbidden',
    });
    expect(store.getRoom('room')?.position).toEqual(position);
    expect(store.getRoom('room')?.entries).toHaveLength(count ?? 0);
    expect(store.getRoom('room')?.owners.get('e')).toBe('actor');
  });

  it('enforces layer LWW and no mutation on stale/equal writes', async () => {
    const { store, driver, request } = setup();
    const first = request({ kind: 'layer-remove', id: 'l', version: 2, editor: 'z' }, store.now);
    const stale = request(
      { kind: 'layer-remove', id: 'l', version: 2, editor: 'a' },
      store.now + 1,
    );
    await driver.commit(first.context, first.commitRequest);
    expect(await driver.commit(stale.context, stale.commitRequest)).toEqual({
      status: 'rejected',
      reason: 'conflict',
    });
    expect(store.getRoom('room')?.state.layers).toEqual([{ id: 'l', version: 2, editor: 'z' }]);
  });

  it('returns typed history loss after metadata was read and published evidence was collected', async () => {
    const { store, driver, request, read, options } = setup();
    const initial = await driver.head(read(), options());
    const change = request({ kind: 'upsert', element: element('e') }, store.now);
    await driver.commit(change.context, change.commitRequest);
    const page = await driver.readAfter(read(), initial, { entries: 8, bytes: 65536 }, options());
    expect(page.status).toBe('ok');
    if (page.status !== 'ok') return;
    const record = page.records[0];
    expect(record).toBeDefined();
    if (!record) return;
    const claims = await driver.claimPublications(
      'publisher',
      { entries: 8, bytes: 65536, leaseMs: 5000 },
      options(),
    );
    expect(claims).toHaveLength(1);
    if (!claims[0]) return;
    await driver.markPublished(claims[0], options());
    store.retirePublished('room', 1);
    expect(await driver.readEvidence(read(), record, options())).toEqual({
      status: 'history-unavailable',
    });
    expect((await driver.checkpoint(read(), options())).state.elements).toHaveLength(1);
  });

  it('authenticates old publications after more than 1024 retirements across fixture instances', async () => {
    const { store, driver, request, read, options } = setup();
    const initial = await driver.head(read(), options());
    const first = request(
      { kind: 'layer-remove', id: 'l', version: 1, editor: 'actor' },
      store.now,
    );
    await driver.commit(first.context, first.commitRequest);
    const page = await driver.readAfter(read(), initial, { entries: 1, bytes: 65536 }, options());
    if (page.status !== 'ok' || !page.records[0]) throw new Error('Expected publication');
    const old = page.records[0];
    expect(old.position.revision.length).toBeLessThanOrEqual(128);
    for (let version = 2; version <= 1026; version++) {
      store.now += 1;
      const next = request({ kind: 'layer-remove', id: 'l', version, editor: 'actor' }, store.now);
      expect((await driver.commit(next.context, next.commitRequest)).status).toBe('committed');
      const claims = await driver.claimPublications(
        'publisher',
        { entries: 1, bytes: 65536, leaseMs: 5000 },
        options(),
      );
      if (!claims[0]) throw new Error('Expected claim');
      await driver.markPublished(claims[0], options());
      store.retirePublished('room', 1);
    }
    expect(await new AuthorityFixtureDriver(store).readEvidence(read(), old, options())).toEqual({
      status: 'history-unavailable',
    });
    for (const tampered of [
      { ...old, before: { ...old.before, nodes: old.before.nodes + 1 } },
      { ...old, position: { ...old.position, revision: `${old.position.revision}0` } },
      { ...old, previous: { ...old.previous, revision: 'forged' } },
      { ...old, extra: true },
    ]) {
      await expect(driver.readEvidence(read(), tampered, options())).rejects.toThrow(
        'Invalid authority evidence reference',
      );
    }
    store.provision('other');
    await expect(driver.readEvidence({ ...read(), room: 'other' }, old, options())).rejects.toThrow(
      'Invalid authority evidence reference',
    );
    store.policy.canRead = () => false;
    expect(await driver.readEvidence(read(), old, options())).toEqual({ status: 'forbidden' });
    store.policy.canRead = () => true;
    store.replace('room', 'new-generation');
    expect(await driver.readEvidence(read(), old, options())).toMatchObject({
      status: 'generation-changed',
    });
  });

  it('uses fenced publication claims and a shared store across driver instances', async () => {
    const { store, driver, request, options } = setup();
    const change = request({ kind: 'upsert', element: element('e') }, store.now);
    await driver.commit(change.context, change.commitRequest);
    const first = await driver.claimPublications(
      'old',
      { entries: 1, bytes: 65536, leaseMs: 1000 },
      options(),
    );
    expect(first).toHaveLength(1);
    store.now += 1001;
    const restarted = new AuthorityFixtureDriver(store);
    const second = await restarted.claimPublications(
      'new',
      { entries: 1, bytes: 65536, leaseMs: 1000 },
      options(),
    );
    expect(second).toHaveLength(1);
    if (!first[0] || !second[0]) return;
    await restarted.markPublished(first[0], options());
    expect(store.getRoom('room')?.entries[0]?.published).toBe(false);
    await restarted.markPublished(second[0], options());
    expect(store.getRoom('room')?.entries[0]?.published).toBe(true);
  });

  it('enforces time, current access and no partial state for precommit failures', async () => {
    const { store, driver, request } = setup();
    const future = request({ kind: 'upsert', element: element('future') }, store.now + 60_001);
    expect(await driver.commit(future.context, future.commitRequest)).toEqual({
      status: 'rejected',
      reason: 'invalid',
    });
    const old = request({ kind: 'upsert', element: element('old') }, store.now - 86_400_001);
    expect(await driver.commit(old.context, old.commitRequest)).toEqual({
      status: 'rejected',
      reason: 'retry-window-expired',
    });
    const candidate = request({ kind: 'upsert', element: element('e') }, store.now);
    store.policy.canRead = () => false;
    expect(await driver.commit(candidate.context, candidate.commitRequest)).toEqual({
      status: 'rejected',
      reason: 'forbidden',
    });
    store.policy.canRead = () => true;
    store.failBeforeCommit = true;
    await expect(driver.commit(candidate.context, candidate.commitRequest)).rejects.toThrow();
    expect(store.getRoom('room')?.state.elements).toEqual([]);
    expect(store.getRoom('room')?.entries).toEqual([]);
    store.failBeforeCommit = false;
    expect((await driver.commit(candidate.context, candidate.commitRequest)).status).toBe(
      'committed',
    );
    store.policy.canRead = () => false;
    expect(await driver.commit(candidate.context, candidate.commitRequest)).toEqual({
      status: 'rejected',
      reason: 'forbidden',
    });
  });

  it('requires current privileged CAS for clear and preserves non-element state', async () => {
    const { store, driver, request, read, options } = setup();
    const create = request({ kind: 'upsert', element: element('e') }, store.now);
    await driver.commit(create.context, create.commitRequest);
    const layer = request(
      { kind: 'layer-remove', id: 'layer', version: 1, editor: 'actor' },
      store.now + 1,
    );
    await driver.commit(layer.context, layer.commitRequest);
    const unprivileged = await driver.checkpoint(read(), options());
    expect(unprivileged.casToken).toBeUndefined();
    await unprivileged.release();
    store.policy.canCaptureCas = () => true;
    const lease = await driver.checkpoint(read(), options());
    const clear = request({ kind: 'clear' }, store.now + 2, lease.casToken);
    expect(await driver.commit(clear.context, clear.commitRequest)).toEqual({
      status: 'rejected',
      reason: 'forbidden',
    });
    store.policy.canClear = () => true;
    expect((await driver.commit(clear.context, clear.commitRequest)).status).toBe('committed');
    expect(store.getRoom('room')?.owners.get('e')).toBe('actor');
    expect(store.getRoom('room')?.state.elements).toEqual([]);
    expect(store.getRoom('room')?.state.layers).toEqual([
      { id: 'layer', version: 1, editor: 'actor' },
    ]);
    const repeat = request({ kind: 'clear' }, store.now + 3, lease.casToken);
    expect(await driver.commit(repeat.context, repeat.commitRequest)).toEqual({
      status: 'rejected',
      reason: 'conflict',
    });
    await lease.release();
  });

  it('validates registered extension correspondence and schema in the transaction', async () => {
    const { store, driver, request } = setup();
    const extension: AuthorityExtension = {
      requirement: {
        key: 'fixture',
        pluginName: 'fixture',
        version: 1,
        validate: (value) => typeof value === 'object' && value !== null,
      },
      extensionKinds: ['fixture:update'],
      prepare: (mutation) =>
        mutation.kind === 'extension' ? { value: mutation.extensionKind } : null,
      changes: () => [],
    };
    store.policy.extensions = [extension];
    store.policy.canUseExtension = () => true;
    const candidate = request(
      { kind: 'extension', extensionKind: 'fixture:update', payload: { n: 1 } },
      store.now,
      undefined,
      'actor',
      createAuthorityOperationId(store.now),
      [extension],
    );
    expect((await driver.commit(candidate.context, candidate.commitRequest)).status).toBe(
      'committed',
    );
    const bad = request(
      { kind: 'extension', extensionKind: 'fixture:update', payload: { n: 2 } },
      store.now + 1,
      undefined,
      'actor',
      createAuthorityOperationId(store.now + 1),
      [extension],
    );
    const forged = {
      ...bad.commitRequest,
      intent: {
        schema: 1 as const,
        kind: 'extension' as const,
        key: 'fixture',
        version: 2,
        payload: { value: 'wrong' },
      },
    };
    expect(await driver.commit(bad.context, forged)).toEqual({
      status: 'rejected',
      reason: 'invalid',
    });
    expect(store.getRoom('room')?.state.extensions['fixture']?.data).toEqual({
      value: 'fixture:update',
    });
  });

  it('preserves a registered plugin name distinct from its key through a C2 checkpoint', async () => {
    const { store, driver, request, read, options } = setup();
    const extension: AuthorityExtension = {
      requirement: { key: 'fog', pluginName: 'vtt', version: 1, validate: () => true },
      extensionKinds: ['fog:update'],
      prepare: () => ({ nested: [1, { enabled: true }] }),
      changes: () => [],
    };
    store.policy.extensions = [extension];
    store.policy.canUseExtension = () => true;
    const candidate = request(
      { kind: 'extension', extensionKind: 'fog:update', payload: {} },
      store.now,
      undefined,
      'actor',
      createAuthorityOperationId(store.now),
      [extension],
    );
    expect((await driver.commit(candidate.context, candidate.commitRequest)).status).toBe(
      'committed',
    );
    const capture = await driver.checkpoint(read(), options());
    expect(capture.state.extensions.fog?.pluginName).toBe('vtt');
    const initial = { generation: 'g', revision: 'initial' };
    const page = await driver.readAfter(read(), initial, { entries: 1, bytes: 65536 }, options());
    if (page.status !== 'ok' || !page.records[0]) throw new Error('Expected publication');
    // Empty state 7 + extension key 1 + record (object/3 keys/2 scalars/data object) 7
    // + nested payload (key/array/scalar/object/key/scalar) 6 = 21.
    expect(page.records[0].after.nodes).toBe(21);
    const checkpoint = await prepareAuthorityCheckpoint(
      {
        cursor: { generation: 'g', streamId: '0'.repeat(32), revision: 0 },
        ...capture.state,
      },
      { requestId: 'r', checkpointId: 'c', requiredExtensions: [extension.requirement] },
    );
    checkpoint.dispose();
    await capture.release();
  });

  it('counts nested JSON nodes in initial and committed evidence references', async () => {
    const { driver, request, read, options, store } = setup();
    expect(
      store.getRoom('room')?.images.get(store.getRoom('room')?.currentImage ?? '')?.ref.nodes,
    ).toBe(7);
    const initial = await driver.head(read(), options());
    const candidate = request({ kind: 'upsert', element: element('e') }, store.now);
    await driver.commit(candidate.context, candidate.commitRequest);
    const page = await driver.readAfter(read(), initial, { entries: 1, bytes: 65536 }, options());
    if (page.status !== 'ok' || !page.records[0]) throw new Error('Expected publication');
    expect(page.records[0].before.nodes).toBe(7);
    // Empty state 7 + stamped element: object 1 + 12 keys + 10 scalar fields
    // + position (object/2 keys/2 values) 5 + size (same) 5 = 40.
    expect(page.records[0].after.nodes).toBe(40);
  });

  it('rejects the fourth 100000-object extension atomically and checkpoints the fitting neighbor', async () => {
    const { store, driver, request, read, options } = setup();
    store.policy.canUseExtension = () => true;
    const payload = Array.from({ length: 100_000 }, () => ({ a: 0 }));
    const extensions: AuthorityExtension[] = Array.from({ length: 4 }, (_, index) => ({
      requirement: { key: `x${index}`, pluginName: 'vtt', version: 1, validate: () => true },
      extensionKinds: [`x${index}:update`],
      prepare: () => payload,
      changes: () => [],
    }));
    store.policy.extensions = extensions;
    for (let index = 0; index < 3; index++) {
      const candidate = request(
        { kind: 'extension', extensionKind: `x${index}:update`, payload: {} },
        store.now + index,
        undefined,
        'actor',
        createAuthorityOperationId(store.now + index),
        extensions,
      );
      expect((await driver.commit(candidate.context, candidate.commitRequest)).status).toBe(
        'committed',
      );
    }
    const room = store.rooms.get('room');
    if (!room) throw new Error('Expected room');
    const before = {
      state: room.state,
      position: room.position,
      cas: room.casToken,
      dedupe: room.dedupe.size,
      floor: room.retiredIssuedAtFloor,
      images: room.images.size,
      entries: room.entries.length,
    };
    const fourth = request(
      { kind: 'extension', extensionKind: 'x3:update', payload: {} },
      store.now + 3,
      undefined,
      'actor',
      createAuthorityOperationId(store.now + 3),
      extensions,
    );
    expect(await driver.commit(fourth.context, fourth.commitRequest)).toEqual({
      status: 'rejected',
      reason: 'overloaded',
    });
    expect(room.state).toBe(before.state);
    expect(room.position).toBe(before.position);
    expect(room.casToken).toBe(before.cas);
    expect(room.dedupe.size).toBe(before.dedupe);
    expect(room.retiredIssuedAtFloor).toBe(before.floor);
    expect(room.images.size).toBe(before.images);
    expect(room.entries).toHaveLength(before.entries);
    store.policy.canCaptureCas = () => true;
    const capture = await driver.checkpoint(read(), options());
    const prepared = await prepareAuthorityCheckpoint(
      {
        cursor: { generation: 'g', streamId: '0'.repeat(32), revision: 0 },
        casToken: capture.casToken,
        ...capture.state,
      },
      {
        requestId: 'r',
        checkpointId: 'c',
        requiredExtensions: extensions.slice(0, 3).map((item) => item.requirement),
      },
    );
    prepared.dispose();
    await capture.release();
  }, 20_000);

  it('distinguishes the exact state-node boundary from complete C2 payload nodes', async () => {
    const { store, driver, request, read, options } = setup();
    store.policy.canUseExtension = () => true;
    const objects = Array.from({ length: 100_000 }, () => ({ a: 0 }));
    let tailLength = 99_951;
    const extensions: AuthorityExtension[] = Array.from({ length: 4 }, (_, index) => ({
      requirement: { key: `x${index}`, pluginName: 'vtt', version: 1, validate: () => true },
      extensionKinds: [`x${index}:update`],
      prepare: () => (index === 3 ? Array(tailLength).fill(0) : objects),
      changes: () => [],
    }));
    store.policy.extensions = extensions;
    for (let index = 0; index < 4; index++) {
      const candidate = request(
        { kind: 'extension', extensionKind: `x${index}:update`, payload: {} },
        store.now + index,
        undefined,
        'actor',
        createAuthorityOperationId(store.now + index),
        extensions,
      );
      expect((await driver.commit(candidate.context, candidate.commitRequest)).status).toBe(
        'committed',
      );
    }
    const room = store.rooms.get('room');
    if (!room) throw new Error('Expected room');
    // Initial state: 7; each object-array extension: 300008; final primitive-array extension: 99959.
    const stateNodes = 7 + 3 * (100_000 * 3 + 8) + (99_951 + 8);
    expect(stateNodes).toBe(999_990);
    // Cursor contributes eight nodes and the CAS property contributes two.
    expect(stateNodes + 10).toBe(1_000_000);
    expect(stateNodes + 1 + 10).toBe(1_000_001);
    expect(room.images.get(room.currentImage)?.ref.nodes).toBe(stateNodes);
    store.policy.canCaptureCas = () => true;
    const capture = await driver.checkpoint(read(), options());
    const prepared = await prepareAuthorityCheckpoint(
      {
        cursor: { generation: 'g', streamId: '0'.repeat(32), revision: 0 },
        casToken: capture.casToken,
        ...capture.state,
      },
      {
        requestId: 'r',
        checkpointId: 'c',
        requiredExtensions: extensions.map((item) => item.requirement),
      },
    );
    prepared.dispose();
    await capture.release();
    tailLength++;
    const overflow = request(
      { kind: 'extension', extensionKind: 'x3:update', payload: {} },
      store.now + 4,
      undefined,
      'actor',
      createAuthorityOperationId(store.now + 4),
      extensions,
    );
    const before = {
      state: room.state,
      position: room.position,
      cas: room.casToken,
      dedupe: room.dedupe.size,
      floor: room.retiredIssuedAtFloor,
      images: room.images.size,
      entries: room.entries.length,
    };
    expect(await driver.commit(overflow.context, overflow.commitRequest)).toEqual({
      status: 'rejected',
      reason: 'overloaded',
    });
    expect(room.state).toBe(before.state);
    expect(room.position).toBe(before.position);
    expect(room.casToken).toBe(before.cas);
    expect(room.dedupe.size).toBe(before.dedupe);
    expect(room.retiredIssuedAtFloor).toBe(before.floor);
    expect(room.images.size).toBe(before.images);
    expect(room.entries).toHaveLength(before.entries);
  }, 20_000);

  it('revalidates malformed Unicode keys and values in a forged direct transaction', async () => {
    const { store, driver, request } = setup();
    let returned: unknown = { text: 'valid' };
    const extension: AuthorityExtension = {
      requirement: { key: 'unicode', pluginName: 'vtt', version: 1, validate: () => true },
      extensionKinds: ['unicode:update'],
      prepare: () => returned as never,
      changes: () => [],
    };
    store.policy.extensions = [extension];
    store.policy.canUseExtension = () => true;
    const room = store.rooms.get('room');
    if (!room) throw new Error('Expected room');
    for (const [index, malformed] of [{ text: '\ud800' }, { ['\udc00']: 1 }].entries()) {
      const candidate = request(
        { kind: 'extension', extensionKind: 'unicode:update', payload: {} },
        store.now + index,
        undefined,
        'actor',
        createAuthorityOperationId(store.now + index),
        [extension],
      );
      // This forged intent bypasses normal preparation; the transaction must reject it itself.
      returned = malformed;
      const forged = {
        ...candidate.commitRequest,
        intent: {
          schema: 1 as const,
          kind: 'extension' as const,
          key: 'unicode',
          version: 1,
          payload: malformed as never,
        },
      };
      const before = {
        state: room.state,
        position: room.position,
        cas: room.casToken,
        dedupe: room.dedupe.size,
        floor: room.retiredIssuedAtFloor,
        images: room.images.size,
        entries: room.entries.length,
      };
      expect(await driver.commit(candidate.context, forged)).toEqual({
        status: 'rejected',
        reason: 'invalid',
      });
      expect(room.state).toBe(before.state);
      expect(room.position).toBe(before.position);
      expect(room.casToken).toBe(before.cas);
      expect(room.dedupe.size).toBe(before.dedupe);
      expect(room.retiredIssuedAtFloor).toBe(before.floor);
      expect(room.images.size).toBe(before.images);
      expect(room.entries).toHaveLength(before.entries);
      returned = { text: 'valid' };
    }
  });

  it('rejects non-JSON direct extension payloads before validators or accessors run', async () => {
    const { store, driver, request } = setup();
    let returned: unknown = { ok: true };
    let validated = 0;
    let accessed = 0;
    const extension: AuthorityExtension = {
      requirement: {
        key: 'json',
        pluginName: 'vtt',
        version: 1,
        validate: () => {
          validated++;
          return true;
        },
      },
      extensionKinds: ['json:update'],
      prepare: () => returned as never,
      changes: () => [],
    };
    store.policy.extensions = [extension];
    store.policy.canUseExtension = () => true;
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const accessor = Object.defineProperty({}, 'x', {
      enumerable: true,
      get: () => {
        accessed++;
        return 1;
      },
    });
    const hidden = Object.defineProperty({}, 'x', { enumerable: false, value: 1 });
    const sparse = Array(1);
    const invalid: unknown[] = [
      { x: undefined },
      { x: NaN },
      cycle,
      accessor,
      hidden,
      sparse,
      new Date(),
    ];
    const room = store.rooms.get('room');
    if (!room) throw new Error('Expected room');
    const originalState = room.state;
    for (const [index, payload] of invalid.entries()) {
      returned = { ok: true };
      const candidate = request(
        { kind: 'extension', extensionKind: 'json:update', payload: {} },
        store.now + index,
        undefined,
        'actor',
        createAuthorityOperationId(store.now + index),
        [extension],
      );
      returned = payload;
      const forged = {
        ...candidate.commitRequest,
        intent: {
          schema: 1 as const,
          kind: 'extension' as const,
          key: 'json',
          version: 1,
          payload: payload as never,
        },
      };
      expect(await driver.commit(candidate.context, forged)).toEqual({
        status: 'rejected',
        reason: 'invalid',
      });
    }
    expect(validated).toBe(0);
    expect(accessed).toBe(0);
    expect(room.state).toBe(originalState);
    expect(room.dedupe.size).toBe(0);
    expect(room.entries).toHaveLength(0);
  });

  it('commits valid Unicode and depth64 JSON through C2 but rejects depth65 atomically', async () => {
    const { store, driver, request, read, options } = setup();
    const nested = (count: number): unknown => {
      let value: unknown = { ['😀']: 'é😀' };
      for (let index = 0; index < count; index++) value = [value];
      return value;
    };
    let depth = 60; // Root, extension map, record, 60 arrays, then the leaf object: depth 64.
    const extension: AuthorityExtension = {
      requirement: { key: 'unicode', pluginName: 'vtt', version: 1, validate: () => true },
      extensionKinds: ['unicode:update'],
      prepare: () => nested(depth) as never,
      changes: () => [],
    };
    store.policy.extensions = [extension];
    store.policy.canUseExtension = () => true;
    const fitting = request(
      { kind: 'extension', extensionKind: 'unicode:update', payload: {} },
      store.now,
      undefined,
      'actor',
      createAuthorityOperationId(store.now),
      [extension],
    );
    expect((await driver.commit(fitting.context, fitting.commitRequest)).status).toBe('committed');
    store.policy.canCaptureCas = () => true;
    const capture = await driver.checkpoint(read(), options());
    const prepared = await prepareAuthorityCheckpoint(
      {
        cursor: { generation: 'g', streamId: '0'.repeat(32), revision: 0 },
        casToken: capture.casToken,
        ...capture.state,
      },
      { requestId: 'r', checkpointId: 'c', requiredExtensions: [extension.requirement] },
    );
    prepared.dispose();
    await capture.release();
    depth = 61;
    const overflow = request(
      { kind: 'extension', extensionKind: 'unicode:update', payload: {} },
      store.now + 1,
      undefined,
      'actor',
      createAuthorityOperationId(store.now + 1),
      [extension],
    );
    const room = store.rooms.get('room');
    if (!room) throw new Error('Expected room');
    const before = {
      state: room.state,
      position: room.position,
      cas: room.casToken,
      dedupe: room.dedupe.size,
      floor: room.retiredIssuedAtFloor,
      images: room.images.size,
      entries: room.entries.length,
    };
    expect(await driver.commit(overflow.context, overflow.commitRequest)).toEqual({
      status: 'rejected',
      reason: 'overloaded',
    });
    expect(room.state).toBe(before.state);
    expect(room.position).toBe(before.position);
    expect(room.casToken).toBe(before.cas);
    expect(room.dedupe.size).toBe(before.dedupe);
    expect(room.retiredIssuedAtFloor).toBe(before.floor);
    expect(room.images.size).toBe(before.images);
    expect(room.entries).toHaveLength(before.entries);
  });

  it('rejects a state that fits but whose privileged C2 payload exceeds 20 MiB', async () => {
    const { store, driver, request, read, options } = setup();
    const room = store.rooms.get('room');
    if (!room) throw new Error('Expected room');
    const extension = { pluginName: 'vtt', version: 1, data: { text: '' } };
    room.extensions.set('large', extension);
    const candidate = request(
      { kind: 'layer-remove', id: 'l', version: 1, editor: 'actor' },
      store.now,
    );
    const candidateState = {
      elements: [],
      layers: [{ id: 'l', version: 1, editor: 'actor' }],
      extensions: { large: extension },
    };
    const checkpoint = {
      cursor: { generation: 'g', streamId: '0'.repeat(32), revision: 0 },
      casToken: '0'.repeat(64),
      ...candidateState,
    };
    const max = 20_971_520;
    const padding = max - Buffer.byteLength(JSON.stringify(candidateState), 'utf8') - 8;
    extension.data.text = 'x'.repeat(padding);
    expect(Buffer.byteLength(JSON.stringify(candidateState), 'utf8')).toBeLessThan(max);
    expect(Buffer.byteLength(JSON.stringify(checkpoint), 'utf8')).toBeGreaterThan(max);
    const before = {
      position: room.position,
      casToken: room.casToken,
      state: room.state,
      entries: room.entries.length,
      dedupe: room.dedupe.size,
      images: room.images.size,
    };
    expect(await driver.commit(candidate.context, candidate.commitRequest)).toEqual({
      status: 'rejected',
      reason: 'overloaded',
    });
    expect(room.position).toBe(before.position);
    expect(room.casToken).toBe(before.casToken);
    expect(room.state).toBe(before.state);
    expect(room.entries).toHaveLength(before.entries);
    expect(room.dedupe.size).toBe(before.dedupe);
    expect(room.images.size).toBe(before.images);
    expect(
      await driver.readAfter(read(), room.position, { entries: 1, bytes: 65536 }, options()),
    ).toMatchObject({ records: [] });
    extension.data.text = 'x'.repeat(padding - 256);
    expect((await driver.commit(candidate.context, candidate.commitRequest)).status).toBe(
      'committed',
    );
    const capture = await driver.checkpoint(read(), options());
    store.policy.canCaptureCas = () => true;
    const privileged = await driver.checkpoint(read(), options());
    const prepared = await prepareAuthorityCheckpoint(
      {
        cursor: { generation: 'g', streamId: '0'.repeat(32), revision: 0 },
        casToken: privileged.casToken,
        ...capture.state,
      },
      {
        requestId: 'r',
        checkpointId: 'c',
        requiredExtensions: [{ key: 'large', pluginName: 'vtt', version: 1, validate: () => true }],
      },
    );
    prepared.dispose();
    await capture.release();
    await privileged.release();
  }, 20_000);

  it('keeps pinned evidence when capacity is tight, then GCs after lease release', async () => {
    const { store, driver, request, read, options } = setup();
    store.maxOutboxEntries = 1;
    const initial = await driver.head(read(), options());
    const first = request({ kind: 'upsert', element: element('one') }, store.now);
    await driver.commit(first.context, first.commitRequest);
    const page = await driver.readAfter(read(), initial, { entries: 1, bytes: 65536 }, options());
    if (page.status !== 'ok' || !page.records[0]) throw new Error('Expected publication');
    const evidence = await driver.readEvidence(read(), page.records[0], options());
    if (evidence.status !== 'available') throw new Error('Expected evidence');
    const claims = await driver.claimPublications(
      'publisher',
      { entries: 1, bytes: 65536, leaseMs: 5000 },
      options(),
    );
    if (!claims[0]) throw new Error('Expected claim');
    await driver.markPublished(claims[0], options());
    const second = request({ kind: 'upsert', element: element('two') }, store.now + 1);
    const nextBytes = Buffer.byteLength(
      JSON.stringify({ elements: [element('one'), element('two')], layers: [], extensions: {} }),
      'utf8',
    );
    const arena = [...(store.getRoom('room')?.images.values() ?? [])].reduce(
      (sum, image) => sum + image.ref.byteLength,
      0,
    );
    store.maxEvidenceBytes = arena + nextBytes - 1;
    expect(await driver.commit(second.context, second.commitRequest)).toEqual({
      status: 'rejected',
      reason: 'overloaded',
    });
    await evidence.lease.release();
    expect((await driver.commit(second.context, second.commitRequest)).status).toBe('committed');
    expect(store.getRoom('room')?.entries).toHaveLength(1);
  });

  it('distinguishes forbidden evidence and replacement generation from history loss', async () => {
    const { store, driver, request, read, options } = setup();
    const initial = await driver.head(read(), options());
    const change = request({ kind: 'upsert', element: element('e') }, store.now);
    await driver.commit(change.context, change.commitRequest);
    const page = await driver.readAfter(read(), initial, { entries: 1, bytes: 65536 }, options());
    if (page.status !== 'ok' || !page.records[0]) throw new Error('Expected publication');
    store.policy.canRead = () => false;
    expect(await driver.readEvidence(read(), page.records[0], options())).toEqual({
      status: 'forbidden',
    });
    store.policy.canRead = () => true;
    store.replace('room', 'new-generation');
    expect(await driver.readEvidence(read(), page.records[0], options())).toEqual({
      status: 'generation-changed',
      head: { generation: 'new-generation', revision: 'initial' },
    });
    expect(store.retiringRooms).toHaveLength(1);
    const claims = await driver.claimPublications(
      'publisher',
      { entries: 1, bytes: 65536, leaseMs: 5000 },
      options(),
    );
    expect(claims[0]?.position.generation).toBe('g');
    if (!claims[0]) throw new Error('Expected retired publication');
    await driver.markPublished(claims[0], options());
    expect(store.retiringRooms).toHaveLength(0);
    expect(() => store.replace('room', 'g')).toThrow('Generation unavailable');
  });

  it('bounds leases, expires store-time pins, and fences late releases', async () => {
    const { store, driver, read, options } = setup();
    const leases = await Promise.all(
      Array.from({ length: 8 }, () => driver.checkpoint(read(), options())),
    );
    await expect(driver.checkpoint(read(), options())).rejects.toThrow('lease capacity');
    store.now += 5000;
    const fresh = await driver.checkpoint(read(), options());
    for (const lease of leases) await lease.release();
    expect(store.getRoom('room')?.images.get(store.getRoom('room')?.currentImage ?? '')?.pins).toBe(
      1,
    );
    await fresh.release();
    await fresh.release();
    expect(store.getRoom('room')?.images.get(store.getRoom('room')?.currentImage ?? '')?.pins).toBe(
      0,
    );
  });

  it('recovers an aged retained receipt before time eviction, then rejects the expired ID', async () => {
    const { store, driver, request } = setup();
    const original = request({ kind: 'upsert', element: element('old') }, store.now);
    const committed = await driver.commit(original.context, original.commitRequest);
    store.now += 86_400_000;
    expect(await driver.commit(original.context, original.commitRequest)).toEqual({
      ...committed,
      replayed: true,
    });
    const current = request({ kind: 'upsert', element: element('current') }, store.now);
    expect((await driver.commit(current.context, current.commitRequest)).status).toBe('committed');
    expect(store.getRoom('room')?.retiredIssuedAtFloor).toBe(store.now - 86_400_000);
    expect(await driver.commit(original.context, original.commitRequest)).toEqual({
      status: 'rejected',
      reason: 'retry-window-expired',
    });
  });

  it('claims globally oldest unpublished records without a connected reader', async () => {
    const { store, driver, read, request, options } = setup();
    store.provision('other');
    const otherActor = { ...read(), room: 'other' };
    const firstProposal = prepareAuthorityProposal(
      otherActor,
      JSON.stringify({
        protocol: 'authority:1',
        kind: 'propose',
        generation: 'g',
        clientOperationId: createAuthorityOperationId(store.now),
        mutation: { kind: 'upsert', element: element('first') },
      }),
    );
    const firstContext: AuthorityCommitContext = {
      ...firstProposal.context,
      ownershipId: 'actor',
      definitionId: 'definition',
    };
    await driver.commit(firstContext, {
      proposal: firstProposal.proposal,
      intent: prepareAuthorityIntent(firstProposal.proposal),
    });
    const second = request({ kind: 'upsert', element: element('second') }, store.now + 1);
    await driver.commit(second.context, second.commitRequest);
    const claims = await driver.claimPublications(
      'publisher',
      { entries: 2, bytes: 65536, leaseMs: 5000 },
      options(),
    );
    expect(claims.map((claim) => claim.room)).toEqual(['other', 'room']);
  });
});
