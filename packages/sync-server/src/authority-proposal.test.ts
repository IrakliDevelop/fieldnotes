import { describe, expect, it, vi, expectTypeOf } from 'vitest';
import type { AuthorityClientFrame } from '@fieldnotes/sync';
import type { AuthContextValue } from './auth-context';
import { prepareAuthorityProposal } from './index';
import type {
  AuthorityProposalActor,
  AuthorityProposalContext,
  AuthorityProposalFrame,
  PreparedAuthorityProposal,
} from './index';

const frame = {
  protocol: 'authority:1',
  kind: 'propose',
  generation: 'g',
  clientOperationId: 'op',
  mutation: { kind: 'remove', id: 'e' },
} as const;
const actor = (changes: Partial<AuthorityProposalActor> = {}): AuthorityProposalActor => ({
  room: 'room',
  actorId: 'principal',
  connectionId: 'socket',
  deadlineAt: Date.now() + 10000,
  signal: new AbortController().signal,
  ...changes,
});

describe('prepareAuthorityProposal', () => {
  it('uses canonical proposal bytes for stable reconnect retries', () => {
    const a = prepareAuthorityProposal(actor(), JSON.stringify(frame));
    const b = prepareAuthorityProposal(
      actor({ connectionId: 'new-socket' }),
      '{ "mutation" : { "id":"e", "kind":"remove" }, "clientOperationId":"op", "generation":"g", "kind":"propose", "protocol":"authority:1" }',
    );
    expect(a.context.operationDigest).toBe(b.context.operationDigest);
    expect(a.context.operationDigest).toBe(
      '420d95175a3e0aa8d015dcc223eb29e0b0d2428c1811c5f995a0568dad8af32b',
    );
  });

  it('binds room, stable principal, generation, operation, mutation and CAS, preserving array order', () => {
    const base = prepareAuthorityProposal(actor(), JSON.stringify(frame)).context.operationDigest;
    const change = (patch: object) =>
      prepareAuthorityProposal(actor(), JSON.stringify({ ...frame, ...patch })).context
        .operationDigest;
    expect(
      prepareAuthorityProposal(actor({ room: 'other' }), JSON.stringify(frame)).context
        .operationDigest,
    ).not.toBe(base);
    expect(
      prepareAuthorityProposal(actor({ actorId: 'other' }), JSON.stringify(frame)).context
        .operationDigest,
    ).not.toBe(base);
    for (const patch of [
      { generation: 'next' },
      { clientOperationId: 'next' },
      { mutation: { kind: 'remove', id: 'other' } },
      { expectedState: 'cas' },
    ])
      expect(change(patch)).not.toBe(base);
    const payload = (items: number[]) =>
      JSON.stringify({
        ...frame,
        mutation: { kind: 'extension', extensionKind: 'x', payload: { items } },
      });
    expect(prepareAuthorityProposal(actor(), payload([1, 2])).context.operationDigest).not.toBe(
      prepareAuthorityProposal(actor(), payload([2, 1])).context.operationDigest,
    );
    expect(
      prepareAuthorityProposal(
        actor({ userId: 'u', role: 'r', authContext: { c: 1 }, expiresAt: Date.now() + 8000 }),
        JSON.stringify(frame),
      ).context.operationDigest,
    ).toBe(base);
  });

  it('copies only declared fields and claims, freezes results, and retains a live caller signal', () => {
    const controller = new AbortController();
    const claims = Object.create(null) as Record<string, AuthContextValue>;
    Object.defineProperty(claims, '__proto__', { value: { inner: 1 }, enumerable: true });
    claims['constructor'] = 'claimed';
    const input = Object.freeze({
      ...actor({ signal: controller.signal }),
      authContext: claims,
      extra: 'ignored',
    });
    const prepared = prepareAuthorityProposal(input, JSON.stringify(frame));
    expect(Object.keys(prepared.context)).not.toContain('extra');
    expect(prepared.context.authContext).not.toBe(claims);
    expect(Object.getPrototypeOf(prepared.context.authContext)).toBeNull();
    expect(prepared.context.authContext?.['__proto__']).toEqual({ inner: 1 });
    expect(Object.isFrozen(prepared.context.authContext?.['__proto__'])).toBe(true);
    claims['constructor'] = 'changed';
    expect(prepared.context.authContext?.['constructor']).toBe('claimed');
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.context)).toBe(true);
    expect(Object.isFrozen(prepared.proposal.mutation)).toBe(true);
    expect(prepared.context.signal).toBe(controller.signal);
    controller.abort();
    expect(prepared.context.signal.aborted).toBe(true);
    expect(JSON.stringify(prepared.proposal)).not.toContain('claimed');
    expect(Object.hasOwn(prepared.context, 'userId')).toBe(false);
    expect(Object.hasOwn(prepared.context, 'expiresAt')).toBe(false);
    const nullActor = Object.assign(Object.create(null) as object, actor());
    expect(
      prepareAuthorityProposal(nullActor as AuthorityProposalActor, JSON.stringify(frame)).proposal,
    ).toEqual(frame);
    const optionalUndefined = prepareAuthorityProposal(
      {
        ...actor(),
        userId: undefined,
        role: undefined,
        authContext: undefined,
        expiresAt: undefined,
      },
      JSON.stringify(frame),
    );
    for (const key of ['userId', 'role', 'authContext', 'expiresAt'])
      expect(Object.hasOwn(optionalUndefined.context, key)).toBe(false);
  });

  it('retains untrusted claimed mutation metadata as request data', () => {
    const proposal = {
      ...frame,
      mutation: {
        kind: 'upsert',
        element: {
          id: 'e',
          type: 'shape',
          position: { x: 0, y: 0 },
          zIndex: 0,
          locked: false,
          layerId: 'l',
          shape: 'rectangle',
          size: { w: 1, h: 1 },
          strokeColor: 'red',
          strokeWidth: 1,
          fillColor: 'blue',
          ownerId: 'untrusted',
          audience: 'private',
        },
      },
    };
    const prepared = prepareAuthorityProposal(actor(), JSON.stringify(proposal));
    expect(prepared.proposal.mutation).toEqual(proposal.mutation);
  });

  it('rejects actor accessors without invoking them, invalid scalars, signals and hostile claims', () => {
    const sentinel = 'PRIVATE_SENTINEL';
    const reject = (value: unknown) => {
      try {
        prepareAuthorityProposal(value as AuthorityProposalActor, JSON.stringify(frame));
      } catch (error) {
        expect(error).toEqual(new TypeError('Invalid authority proposal'));
        expect(String(error)).not.toContain(sentinel);
        return;
      }
      throw new Error('expected rejection');
    };
    const accessor = { ...actor() };
    Object.defineProperty(accessor, 'actorId', {
      enumerable: true,
      get: () => {
        throw new Error(sentinel);
      },
    });
    reject(accessor);
    const unrelatedAccessor = { ...actor() };
    Object.defineProperty(unrelatedAccessor, 'ignored', {
      enumerable: true,
      get: () => {
        throw new Error(sentinel);
      },
    });
    expect(() => prepareAuthorityProposal(unrelatedAccessor, JSON.stringify(frame))).not.toThrow();
    const hidden = { ...actor() };
    Object.defineProperty(hidden, 'room', { value: 'room', enumerable: false });
    reject(hidden);
    reject({ ...actor(), [Symbol('secret')]: 1 });
    for (const patch of [
      { room: 'bad:room' },
      { actorId: '' },
      { connectionId: 'x'.repeat(1025) },
      { actorId: '\ud800' },
      { userId: '\udfff' },
      { role: '€'.repeat(342) },
      { deadlineAt: 0 },
      { deadlineAt: 1.5 },
      { expiresAt: -1 },
      { signal: { aborted: false } },
      { signal: Object.create(AbortSignal.prototype) },
    ])
      reject({ ...actor(), ...patch });
    const claimGetter = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(claimGetter, 'secret', {
      enumerable: true,
      get: () => {
        throw new Error(sentinel);
      },
    });
    reject({ ...actor(), authContext: claimGetter });
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    reject({ ...actor(), authContext: cycle });
    reject({ ...actor(), authContext: { huge: sentinel.repeat(4000) } });
    let deep: unknown = null;
    for (let i = 0; i < 17; i++) deep = { next: deep };
    reject({ ...actor(), authContext: deep });
    reject(
      new Proxy(actor(), {
        ownKeys: () => {
          throw new Error(sentinel);
        },
      }),
    );
  });

  it('rejects malformed, oversized, deep and wrong-direction frames generically', () => {
    const messages: unknown[] = [
      null,
      7,
      'PRIVATE_SENTINEL',
      '{',
      JSON.stringify({ ...frame, kind: 'checkpoint-request' }),
      JSON.stringify({
        protocol: 'authority:1',
        kind: 'receipt',
        receipt: { generation: 'g', clientOperationId: 'op', receiptId: 'r' },
      }),
      JSON.stringify({ ...frame, mutation: { kind: 'clear' } }),
      JSON.stringify({ ...frame, mutation: { kind: 'clear' }, expectedState: null }),
      JSON.stringify({ from: 'x', op: { kind: 'remove', id: 'e' } }),
      JSON.stringify({
        ...frame,
        mutation: {
          kind: 'extension',
          extensionKind: 'x',
          payload: { huge: 'a'.repeat(1_048_576) },
        },
      }),
      JSON.stringify({
        ...frame,
        mutation: {
          kind: 'extension',
          extensionKind: 'x',
          payload: { nested: JSON.parse('['.repeat(65) + '0' + ']'.repeat(65)) },
        },
      }),
    ];
    for (const message of messages)
      expect(() => prepareAuthorityProposal(actor(), message as string)).toThrow(
        new TypeError('Invalid authority proposal'),
      );
  });

  it('clamps deadlines and checks expiry at entry and after preparation without timers', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
    const timer = vi.spyOn(globalThis, 'setTimeout');
    try {
      expect(
        prepareAuthorityProposal(actor({ deadlineAt: 20000 }), JSON.stringify(frame)).context
          .deadlineAt,
      ).toBe(15000);
      expect(
        prepareAuthorityProposal(actor({ deadlineAt: 12000 }), JSON.stringify(frame)).context
          .deadlineAt,
      ).toBe(12000);
      expect(
        prepareAuthorityProposal(
          actor({ deadlineAt: 20000, expiresAt: 11000 }),
          JSON.stringify(frame),
        ).context.deadlineAt,
      ).toBe(11000);
      expect(() =>
        prepareAuthorityProposal(actor({ deadlineAt: 10000 }), JSON.stringify(frame)),
      ).toThrow(new Error('Authority proposal expired'));
      expect(() =>
        prepareAuthorityProposal(actor({ expiresAt: 10000 }), JSON.stringify(frame)),
      ).toThrow(new Error('Authority proposal expired'));
      const controller = new AbortController();
      controller.abort();
      expect(() =>
        prepareAuthorityProposal(actor({ signal: controller.signal }), JSON.stringify(frame)),
      ).toThrow(new Error('Authority proposal expired'));
      const delayed = actor({ deadlineAt: 20000 });
      clock.mockReturnValueOnce(10000).mockReturnValue(15000);
      expect(() => prepareAuthorityProposal(delayed, JSON.stringify(frame))).toThrow(
        new Error('Authority proposal expired'),
      );
      expect(timer).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
      timer.mockRestore();
    }
  });

  it('exports readonly public contracts', () => {
    expectTypeOf<AuthorityProposalFrame>().toEqualTypeOf<
      Extract<AuthorityClientFrame, { kind: 'propose' }>
    >();
    expectTypeOf<PreparedAuthorityProposal['context']>().toEqualTypeOf<AuthorityProposalContext>();
    expectTypeOf<AuthorityProposalContext['signal']>().toEqualTypeOf<AbortSignal>();
  });
});
