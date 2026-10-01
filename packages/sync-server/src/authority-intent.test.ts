import { describe, expect, it, vi } from 'vitest';
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
  const returned = (value: unknown) => {
    const source = proposal({ kind: 'extension', extensionKind: 'x', payload: {} }).proposal;
    const extension: AuthorityExtension = {
      requirement: { key: 'x', pluginName: 'plugin', version: 1, validate: () => true },
      extensionKinds: ['x'],
      prepare: () => value as never,
      changes: () => [],
    };
    return () => prepareAuthorityIntent(source, [extension]);
  };

  it('admits exact serialized extension bytes and rejects one byte over, including escapes', () => {
    const exact = 'x'.repeat(1_048_574);
    expect(returned(exact)()).toMatchObject({ kind: 'extension', payload: exact });
    expect(returned(`${exact}x`)).toThrow('Invalid authority intent');
    const escaped = `${'\u0000'.repeat(174_762)}xx`;
    expect(returned(escaped)()).toMatchObject({ kind: 'extension', payload: escaped });
    expect(returned(`${escaped}x`)).toThrow('Invalid authority intent');
    const key = '\u0000'.repeat(174_762);
    expect(returned({ [key]: null })).toThrow('Invalid authority intent');
    expect(returned(['x'.repeat(1_048_574)])).toThrow('Invalid authority intent');
  });

  it('rejects oversized callback output before SDK serialization or ordinary inventories', () => {
    const expanded = '\u0000'.repeat(300_000);
    const repeated = Array.from({ length: 300 }, () => expanded);
    const wide = Object.fromEntries(
      Array.from({ length: 120_000 }, (_, index) => [`k${index}`, null]),
    );
    const array = Array.from({ length: 600_000 }, () => null);
    const originalStringify = JSON.stringify;
    const stringify = vi.spyOn(JSON, 'stringify').mockImplementation((value) => {
      if (value === expanded || (Array.isArray(value) && value.length === repeated.length))
        throw new TypeError('Invalid authority intent');
      return originalStringify(value);
    });
    const originalOwnKeys = Reflect.ownKeys;
    const ownKeys = vi.spyOn(Reflect, 'ownKeys').mockImplementation((value) => {
      if (value === wide || value === array) throw new TypeError('Invalid authority intent');
      return originalOwnKeys(value);
    });
    try {
      for (const value of [expanded, repeated, wide, array]) {
        expect(returned(value)).toThrow('Invalid authority intent');
      }
      expect(stringify.mock.calls.some(([value]) => value === expanded)).toBe(false);
      expect(
        stringify.mock.calls.some(([value]) => Array.isArray(value) && value.length === 300),
      ).toBe(false);
      expect(
        ownKeys.mock.calls
          .filter(([value]) => value === wide || value === array)
          .map(([value]) => (value === wide ? 'wide' : 'array')),
      ).toEqual([]);
    } finally {
      ownKeys.mockRestore();
      stringify.mockRestore();
    }
  });
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
    if (intent.kind === 'extension') {
      expect(Object.isFrozen(intent.payload)).toBe(true);
      expect(Object.isFrozen((intent.payload as { nested: object }).nested)).toBe(true);
      expect(Object.getPrototypeOf(intent.payload)).toBe(null);
    }
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
    const nullProto = Object.assign(Object.create(null) as Record<string, unknown>, {
      ['😀']: 'é😀',
    });
    const accepted = prepareAuthorityIntent(source, [extension(nullProto)]);
    expect(accepted.kind).toBe('extension');
    if (accepted.kind === 'extension') {
      expect(accepted.payload).toEqual(nullProto);
      expect(Object.getPrototypeOf(accepted.payload)).toBe(null);
    }
  });
});
