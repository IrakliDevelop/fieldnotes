import { describe, expect, it } from 'vitest';
import type { AuthorityMutation } from '@fieldnotes/sync';
import { prepareAuthorityProposal } from './authority-proposal';
import { prepareAuthorityIntent } from './authority-intent';
import type { AuthorityExtension, AuthorityProposalActor } from './index';

const actor = (): AuthorityProposalActor => ({
  room: 'room',
  actorId: 'actor',
  connectionId: 'connection',
  deadlineAt: Date.now() + 5000,
  signal: new AbortController().signal,
});
const proposal = (mutation: AuthorityMutation) =>
  prepareAuthorityProposal(
    actor(),
    JSON.stringify({
      protocol: 'authority:1',
      kind: 'propose',
      generation: 'g',
      clientOperationId: 'op',
      mutation,
    }),
  );

describe('prepareAuthorityIntent', () => {
  it('strips a claimed owner without changing the original proposal or digest', () => {
    const original = proposal({
      kind: 'upsert',
      element: {
        id: 'element',
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
        ownerId: 'claimed',
      },
    });
    const digest = original.context.operationDigest;
    const intent = prepareAuthorityIntent(original.proposal);
    expect(intent.kind).toBe('element-upsert');
    if (intent.kind !== 'element-upsert') return;
    expect(Object.hasOwn(intent.element, 'ownerId')).toBe(false);
    expect(original.proposal.mutation).toHaveProperty('element.ownerId', 'claimed');
    expect(original.context.operationDigest).toBe(digest);
    expect(Object.isFrozen(intent.element)).toBe(true);
    expect(Object.isFrozen(intent.element.position)).toBe(true);
  });

  it('maps layer tombstones and refuses unsupported core fog and extensions', () => {
    expect(
      prepareAuthorityIntent(
        proposal({ kind: 'layer-remove', id: 'layer', version: 2, editor: 'actor' }).proposal,
      ),
    ).toEqual({
      schema: 1,
      kind: 'layer-write',
      record: { id: 'layer', version: 2, editor: 'actor' },
    });
    expect(() =>
      prepareAuthorityIntent(
        proposal({ kind: 'extension', extensionKind: 'x', payload: { value: 1 } }).proposal,
      ),
    ).toThrow('Unsupported authority extension');
    expect(() =>
      prepareAuthorityIntent(
        proposal({ kind: 'fog-meta', record: { version: 1, editor: 'actor' } }).proposal,
      ),
    ).toThrow('Unsupported authority extension');
  });

  it('copies and freezes prepared extension payload without exposing caller mutation', () => {
    const preparedPayload = { nested: { value: 1 } };
    const extension: AuthorityExtension = {
      requirement: { key: 'plugin', pluginName: 'plugin', version: 1, validate: () => true },
      extensionKinds: ['x'],
      prepare: () => preparedPayload,
      changes: () => [],
    };
    const original = proposal({ kind: 'extension', extensionKind: 'x', payload: {} });
    const intent = prepareAuthorityIntent(original.proposal, [extension]);
    preparedPayload.nested.value = 2;
    expect(intent).toEqual({
      schema: 1,
      kind: 'extension',
      key: 'plugin',
      version: 1,
      payload: { nested: { value: 1 } },
    });
    if (intent.kind === 'extension') expect(Object.isFrozen(intent.payload)).toBe(true);
  });

  it('rejects invalid prepared JSON and throwing callbacks with generic errors', () => {
    const source = proposal({ kind: 'extension', extensionKind: 'x', payload: {} }).proposal;
    const extension = (prepare: AuthorityExtension['prepare']): AuthorityExtension => ({
      requirement: { key: 'x', pluginName: 'plugin', version: 1, validate: () => true },
      extensionKinds: ['x'],
      prepare,
      changes: () => [],
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const accessor = Object.defineProperty({}, 'secret', { enumerable: true, get: () => 1 });
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error('private detail');
        },
      },
    );
    for (const value of [NaN, Infinity, undefined, cyclic, accessor, new Date(), hostile]) {
      expect(() => prepareAuthorityIntent(source, [extension(() => value as never)])).toThrow(
        'Invalid authority intent',
      );
    }
    expect(() =>
      prepareAuthorityIntent(source, [
        extension(() => {
          throw new Error('private detail');
        }),
      ]),
    ).toThrow('Invalid authority intent');
  });

  it('rejects lone surrogates in returned keys and values but accepts valid Unicode', () => {
    const source = proposal({ kind: 'extension', extensionKind: 'x', payload: {} }).proposal;
    const extension = (value: unknown): AuthorityExtension => ({
      requirement: { key: 'x', pluginName: 'plugin', version: 1, validate: () => true },
      extensionKinds: ['x'],
      prepare: () => value as never,
      changes: () => [],
    });
    for (const value of [
      { text: '\ud800' },
      { text: '\udc00' },
      { ['\ud800']: 1 },
      { ['\udc00']: 1 },
    ]) {
      expect(() => prepareAuthorityIntent(source, [extension(value)])).toThrow(
        'Invalid authority intent',
      );
    }
    const intent = prepareAuthorityIntent(source, [extension({ ['😀']: 'é\ud83d\ude00' })]);
    expect(intent.kind === 'extension' && intent.payload).toEqual({ ['😀']: 'é😀' });
  });
});
