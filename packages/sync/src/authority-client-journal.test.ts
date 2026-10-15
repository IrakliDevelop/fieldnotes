import { describe, expect, it, vi } from 'vitest';
import {
  AuthorityClientJournal,
  AuthorityWaiterBudget,
  MAX_AUTHORITY_BARRIERS,
  MAX_AUTHORITY_BARRIER_REFERENCES,
  MAX_AUTHORITY_JOURNAL_BYTES,
  MAX_AUTHORITY_JOURNAL_OPERATIONS,
  MAX_AUTHORITY_WAITERS,
} from './authority-client-journal';
import { MAX_AUTHORITY_FRAME_BYTES, serializeAuthorityFrame } from './authority-protocol';
import type { AuthorityMutation } from './authority-protocol';
import type {
  AuthorityBarrier,
  AuthorityBarrierResult,
  AuthorityClientOperation,
  AuthorityReadonly,
} from './authority-client-types';

const encoder = new TextEncoder();

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type ReadonlyKey<T, K extends keyof T> = Equal<Pick<T, K>, Readonly<Pick<T, K>>>;
const recursiveReadonly: Equal<
  AuthorityReadonly<{ nested: { values: string[] } }>,
  { readonly nested: { readonly values: readonly string[] } }
> = true;
const operationReadonly: ReadonlyKey<AuthorityClientOperation, 'proposal'> = true;
const barrierReadonly: ReadonlyKey<AuthorityBarrier, 'operationIds'> = true;
const barrierResultReadonly: ReadonlyKey<AuthorityBarrierResult, 'accepted'> = true;

function idFactory(prefix = 'op'): () => string {
  let next = 0;
  return () => `${prefix}-${String(++next).padStart(3, '0')}`;
}

function journal(
  options: {
    readonly operationId?: () => string;
    readonly barrierId?: () => string;
    readonly waiterBudget?: AuthorityWaiterBudget;
  } = {},
): AuthorityClientJournal {
  const result = new AuthorityClientJournal({
    scopeId: 'room:a',
    createOperationId: options.operationId ?? idFactory(),
    createBarrierId: options.barrierId ?? idFactory('barrier'),
    waiterBudget: options.waiterBudget,
  });
  result.setGeneration('generation-1');
  return result;
}

function admit(
  target: AuthorityClientJournal,
  mutation: AuthorityMutation = { kind: 'remove', id: 'element' },
): string {
  const result = target.admit(mutation);
  if (result.status !== 'admitted') throw new Error(`admission failed: ${result.reason}`);
  return result.clientOperationId;
}

function receipt(target: AuthorityClientJournal, id: string, receiptId = `receipt-${id}`): void {
  expect(
    target.recordReceipt({
      generation: 'generation-1',
      clientOperationId: id,
      receiptId,
    }),
  ).toBe('accepted');
}

function oneFrameMutation(clientOperationId: string): AuthorityMutation {
  const empty: AuthorityMutation = { kind: 'extension', extensionKind: 'x', payload: '' };
  const base = serializeAuthorityFrame({
    protocol: 'authority:1',
    kind: 'propose',
    generation: 'generation-1',
    clientOperationId,
    mutation: empty,
  });
  const payloadBytes = MAX_AUTHORITY_FRAME_BYTES - encoder.encode(base).length;
  return { kind: 'extension', extensionKind: 'x', payload: 'x'.repeat(payloadBytes) };
}

describe('AuthorityClientJournal immutable admission', () => {
  it('declares recursively readonly public journal values', () => {
    expect([recursiveReadonly, operationReadonly, barrierReadonly, barrierResultReadonly]).toEqual(
      Array(4).fill(true),
    );
  });

  it('freezes admitted identity and barrier membership across caller and later mutations', () => {
    const operationIds = ['op-1', 'op-2'];
    const target = journal({
      operationId: () => operationIds.shift() ?? 'unexpected',
      barrierId: () => 'barrier-1',
    });
    const mutation = { kind: 'remove' as const, id: 'element-1' };
    const options = { expectedState: 'cas-1' };

    expect(target.admit(mutation, options)).toEqual({
      status: 'admitted',
      clientOperationId: 'op-1',
    });
    const retained = target.operations()[0];
    if (retained === undefined) throw new Error('missing retained operation');
    const originalWire = retained.originalWire;
    mutation.id = 'caller-mutated';
    options.expectedState = 'caller-mutated';

    expect(retained.proposal.mutation).toEqual({ kind: 'remove', id: 'element-1' });
    expect(retained.proposal.expectedState).toBe('cas-1');
    expect(retained.originalWire).toBe(originalWire);
    expect(target.prepareRetry('op-1', 'generation-1', true)).toMatchObject({
      status: 'ready',
      originalWire,
      proposal: retained.proposal,
    });

    const barrier = target.captureBarrier();
    if (barrier === null) throw new Error('missing barrier');
    expect(target.admit({ kind: 'remove', id: 'element-2' })).toEqual({
      status: 'admitted',
      clientOperationId: 'op-2',
    });
    expect(barrier.operationIds).toEqual(['op-1']);
    expect(barrier.throughLocalSequence).toBe(1);
    expect(barrier.localEditGeneration).toBe(0);
    expect(Object.isFrozen(barrier.operationIds)).toBe(true);
    expect(target.operations()[1]?.localEditGeneration).toBe(1);
  });

  it('publishes bounded deeply frozen copies and rejects invalid proposals atomically', () => {
    const target = journal();
    const id = admit(target, {
      kind: 'extension',
      extensionKind: 'nested',
      payload: { array: [{ value: 1 }] },
    });
    const operations = target.operations();
    const operation = operations[0];
    if (operation === undefined || operation.proposal.mutation.kind !== 'extension') {
      throw new Error('fixture');
    }
    const payload = operation.proposal.mutation.payload as { readonly array: readonly object[] };
    expect(Object.isFrozen(operations)).toBe(true);
    expect(Object.isFrozen(operation)).toBe(true);
    expect(Object.isFrozen(operation.proposal)).toBe(true);
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.array)).toBe(true);
    expect(Object.isFrozen(payload.array[0])).toBe(true);
    expect(() => {
      (operation.proposal.mutation as { id: string }).id = 'mutated';
    }).toThrow(TypeError);
    expect(target.operation(id)).toBe(operation);

    const before = target.stats();
    expect(target.admit({ kind: 'clear' })).toEqual({ status: 'refused', reason: 'invalid' });
    expect(target.stats()).toEqual(before);
  });

  it('handles duplicate or throwing ID factories without sequence or accounting drift', () => {
    const ids = ['same', 'same'];
    const target = journal({ operationId: () => ids.shift() ?? 'same' });
    expect(admit(target)).toBe('same');
    const before = target.stats();
    expect(target.admit({ kind: 'remove', id: 'other' })).toEqual({
      status: 'refused',
      reason: 'invalid',
    });
    expect(target.stats()).toEqual(before);

    const throwing = journal({
      operationId: () => {
        throw new Error('ID callback failed');
      },
    });
    expect(throwing.admit({ kind: 'remove', id: 'x' })).toEqual({
      status: 'refused',
      reason: 'invalid',
    });
    expect(throwing.stats().operationCount).toBe(0);
  });
});

describe('AuthorityClientJournal attempts and outcomes', () => {
  it('distinguishes no handoff, pending handoff, thrown ambiguity, and disconnect', () => {
    const target = journal();
    const noHandoff = admit(target);
    expect(target.attemptOperation(noHandoff, () => false)).toBe('draft');
    expect(target.operation(noHandoff)).toMatchObject({ status: 'draft', attempts: 0 });
    expect(target.attemptOperation(noHandoff, () => true)).toBe('pending');
    expect(target.operation(noHandoff)).toMatchObject({ status: 'pending', attempts: 1 });
    expect(target.attemptOperation(noHandoff, () => true)).toBe('invalid');

    const ambiguous = admit(target);
    expect(
      target.attemptOperation(ambiguous, () => {
        throw new Error('ambiguous transport failure');
      }),
    ).toBe('uncertain');
    expect(target.operation(ambiguous)).toMatchObject({
      status: 'uncertain',
      attempts: 1,
      wasUncertain: true,
    });
    expect(target.attemptOperation(ambiguous, () => false)).toBe('uncertain');
    expect(target.operation(ambiguous)?.attempts).toBe(1);
    expect(target.attemptOperation(ambiguous, () => true)).toBe('pending');
    expect(target.operation(ambiguous)).toMatchObject({ status: 'pending', attempts: 2 });

    target.markAttemptedUncertain();
    expect(target.operation(noHandoff)?.status).toBe('uncertain');
    expect(target.operation(ambiguous)?.status).toBe('uncertain');
  });

  it('accepts only matching receipts and reports accepted-result conflicts', () => {
    const target = journal();
    const id = admit(target);
    target.attemptOperation(id, () => true);
    expect(
      target.recordReceipt({ generation: 'other', clientOperationId: id, receiptId: 'wrong' }),
    ).toBe('ignored');
    expect(
      target.recordReceipt({
        generation: 'generation-1',
        clientOperationId: 'unknown',
        receiptId: 'unknown',
      }),
    ).toBe('ignored');
    receipt(target, id, 'receipt-1');
    expect(target.operation(id)).toMatchObject({
      status: 'accepted',
      receipt: { receiptId: 'receipt-1' },
    });
    expect(
      target.recordReceipt({
        generation: 'generation-1',
        clientOperationId: id,
        receiptId: 'receipt-1',
      }),
    ).toBe('duplicate');
    expect(
      target.recordReceipt({
        generation: 'generation-1',
        clientOperationId: id,
        receiptId: 'receipt-conflict',
      }),
    ).toBe('conflict');
    expect(target.recordRejection('generation-1', id, 'conflict')).toBe('conflict');
    expect(target.operation(id)?.receipt?.receiptId).toBe('receipt-1');
  });

  it('keeps definite and uncertain rejection semantics distinct and lets receipts dominate', () => {
    const target = journal();
    const definite = admit(target);
    expect(target.recordRejection('generation-1', definite, 'forbidden')).toBe('invalid');
    target.attemptOperation(definite, () => true);
    expect(target.recordRejection('generation-1', definite, 'forbidden')).toBe('rejected');
    expect(target.operation(definite)).toMatchObject({
      status: 'rejected',
      rejection: 'forbidden',
      wasUncertain: false,
    });
    expect(target.recordRejection('generation-1', definite, 'forbidden')).toBe('duplicate');
    expect(target.recordRejection('generation-1', definite, 'conflict')).toBe('conflict');
    receipt(target, definite);
    expect(target.operation(definite)?.status).toBe('accepted');

    const expired = admit(target);
    target.attemptOperation(expired, () => true);
    expect(target.recordRejection('generation-1', expired, 'retry-window-expired')).toBe(
      'uncertain',
    );
    expect(target.operation(expired)).toMatchObject({
      status: 'uncertain',
      rejection: 'retry-window-expired',
      wasUncertain: true,
    });
    receipt(target, expired);
    expect(target.operation(expired)?.status).toBe('accepted');

    const ambiguous = admit(target);
    target.attemptOperation(ambiguous, () => {
      throw new Error('ambiguous');
    });
    expect(target.recordRejection('generation-1', ambiguous, 'invalid')).toBe('uncertain');
    expect(target.operation(ambiguous)).toMatchObject({
      status: 'uncertain',
      rejection: 'invalid',
    });
  });

  it('retains old-generation pending work as uncertain across generation replacement', () => {
    const target = journal();
    const id = admit(target);
    target.attemptOperation(id, () => true);
    expect(target.setGeneration('generation-2')).toBe(true);
    expect(target.operation(id)).toMatchObject({
      generation: 'generation-1',
      status: 'uncertain',
      wasUncertain: true,
    });
    expect(target.prepareRetry(id, 'generation-2', true)).toEqual({
      status: 'refused',
      reason: 'generation-mismatch',
    });
    const send = vi.fn(() => true);
    expect(target.attemptOperation(id, send)).toBe('invalid');
    expect(send).not.toHaveBeenCalled();
    expect(target.setGeneration('bad generation')).toBe(false);
    expect(target.generation).toBe('generation-2');
  });

  it('revalidates generation after reentrant handoff callbacks without losing receipt dominance', () => {
    const handedOff = journal();
    const handedOffId = admit(handedOff);
    const handedOffWire = handedOff.operation(handedOffId)?.originalWire;
    expect(
      handedOff.attemptOperation(handedOffId, (wire) => {
        expect(wire).toBe(handedOffWire);
        expect(handedOff.setGeneration('generation-2')).toBe(true);
        return true;
      }),
    ).toBe('uncertain');
    expect(handedOff.operation(handedOffId)).toMatchObject({
      generation: 'generation-1',
      originalWire: handedOffWire,
      status: 'uncertain',
      attempts: 1,
      wasUncertain: true,
    });
    expect(handedOff.releaseOperation(handedOffId, { discardDraft: true })).toBe(true);

    const notHandedOff = journal();
    const draftId = admit(notHandedOff);
    expect(
      notHandedOff.attemptOperation(draftId, () => {
        expect(notHandedOff.setGeneration('generation-2')).toBe(true);
        return false;
      }),
    ).toBe('draft');
    expect(notHandedOff.operation(draftId)).toMatchObject({
      generation: 'generation-1',
      status: 'draft',
      attempts: 0,
      wasUncertain: false,
    });
    expect(notHandedOff.setGeneration('generation-1')).toBe(true);
    expect(notHandedOff.prepareRetry(draftId, 'generation-1', true).status).toBe('ready');

    const accepted = journal();
    const acceptedId = admit(accepted);
    expect(
      accepted.attemptOperation(acceptedId, () => {
        receipt(accepted, acceptedId, 'receipt-during-send');
        expect(accepted.setGeneration('generation-2')).toBe(true);
        return true;
      }),
    ).toBe('invalid');
    expect(accepted.operation(acceptedId)).toMatchObject({
      status: 'accepted',
      attempts: 1,
      receipt: { receiptId: 'receipt-during-send' },
    });
  });

  it('detects generation ABA across true, false, throw, and accepted handoff callbacks', () => {
    const aba = (target: AuthorityClientJournal): void => {
      expect(target.setGeneration('generation-2')).toBe(true);
      expect(target.setGeneration('generation-1')).toBe(true);
    };

    const handedOff = journal();
    const handedOffId = admit(handedOff);
    const handedOffWire = handedOff.operation(handedOffId)?.originalWire;
    expect(
      handedOff.attemptOperation(handedOffId, (wire) => {
        expect(wire).toBe(handedOffWire);
        aba(handedOff);
        return true;
      }),
    ).toBe('uncertain');
    expect(handedOff.operation(handedOffId)).toMatchObject({
      clientOperationId: handedOffId,
      originalWire: handedOffWire,
      status: 'uncertain',
      attempts: 1,
      wasUncertain: true,
    });
    expect(handedOff.prepareRetry(handedOffId, 'generation-1', true)).toMatchObject({
      status: 'ready',
      clientOperationId: handedOffId,
      originalWire: handedOffWire,
    });
    expect(handedOff.releaseOperation(handedOffId, { discardDraft: true })).toBe(true);

    const notHandedOff = journal();
    const draftId = admit(notHandedOff);
    const draftWire = notHandedOff.operation(draftId)?.originalWire;
    expect(
      notHandedOff.attemptOperation(draftId, () => {
        aba(notHandedOff);
        return false;
      }),
    ).toBe('draft');
    expect(notHandedOff.operation(draftId)).toMatchObject({
      originalWire: draftWire,
      status: 'draft',
      attempts: 0,
      wasUncertain: false,
    });
    expect(notHandedOff.prepareRetry(draftId, 'generation-1', true)).toMatchObject({
      status: 'ready',
      clientOperationId: draftId,
      originalWire: draftWire,
    });
    expect(notHandedOff.releaseOperation(draftId, { discardDraft: true })).toBe(true);

    const threw = journal();
    const threwId = admit(threw);
    expect(
      threw.attemptOperation(threwId, () => {
        aba(threw);
        throw new Error('ambiguous ABA handoff');
      }),
    ).toBe('uncertain');
    expect(threw.operation(threwId)).toMatchObject({
      status: 'uncertain',
      attempts: 1,
      wasUncertain: true,
    });
    expect(threw.releaseOperation(threwId, { discardDraft: true })).toBe(true);

    const accepted = journal();
    const acceptedId = admit(accepted);
    expect(
      accepted.attemptOperation(acceptedId, () => {
        aba(accepted);
        receipt(accepted, acceptedId, 'receipt-after-aba');
        return true;
      }),
    ).toBe('invalid');
    expect(accepted.operation(acceptedId)).toMatchObject({
      status: 'accepted',
      attempts: 1,
      receipt: { receiptId: 'receipt-after-aba' },
    });
    expect(accepted.releaseOperation(acceptedId)).toBe(true);
  });

  it('admits retries only for live same-generation drafts and uncertain records, including pins', () => {
    const target = journal();
    const draft = admit(target);
    expect(target.prepareRetry(draft, 'generation-1', false)).toEqual({
      status: 'refused',
      reason: 'not-live',
    });
    expect(target.prepareRetry('unknown', 'generation-1', true)).toEqual({
      status: 'refused',
      reason: 'unknown',
    });
    expect(target.prepareRetry(draft, 'other', true)).toEqual({
      status: 'refused',
      reason: 'generation-mismatch',
    });
    const barrier = target.captureBarrier();
    if (barrier === null) throw new Error('fixture');
    expect(target.prepareRetry(draft, 'generation-1', true).status).toBe('ready');
    target.attemptOperation(draft, () => true);
    expect(target.prepareRetry(draft, 'generation-1', true)).toEqual({
      status: 'refused',
      reason: 'pending',
    });
    target.markAttemptedUncertain();
    expect(target.prepareRetry(draft, 'generation-1', true).status).toBe('ready');
    receipt(target, draft);
    expect(target.prepareRetry(draft, 'generation-1', true)).toEqual({
      status: 'refused',
      reason: 'accepted',
    });

    const rejected = admit(target);
    target.attemptOperation(rejected, () => true);
    target.recordRejection('generation-1', rejected, 'forbidden');
    expect(target.prepareRetry(rejected, 'generation-1', true)).toEqual({
      status: 'refused',
      reason: 'rejected',
    });
  });

  it('keeps exact wire through a callback and protects records from callback release or mutation', () => {
    const target = journal();
    const id = admit(target, { kind: 'remove', id: 'original' });
    const operation = target.operation(id);
    if (operation === null) throw new Error('fixture');
    expect(
      target.attemptOperation(id, (wire) => {
        expect(wire).toBe(operation.originalWire);
        expect(target.releaseOperation(id, { discardDraft: true })).toBe(false);
        expect(() => {
          (target.operation(id) as { status: string }).status = 'accepted';
        }).toThrow(TypeError);
        throw new Error('transport callback');
      }),
    ).toBe('uncertain');
    expect(target.operation(id)).toMatchObject({ status: 'uncertain', attempts: 1 });
  });

  it.each([
    { handoff: 'false', expectedAttempts: 0 },
    { handoff: 'true', expectedAttempts: 1 },
    { handoff: 'throw', expectedAttempts: 1 },
  ] as const)(
    'preserves a reentrant initial rejection when handoff returns $handoff',
    ({ handoff, expectedAttempts }) => {
      const target = journal();
      const id = admit(target);
      const originalWire = target.operation(id)?.originalWire;
      const result = target.attemptOperation(id, (wire) => {
        expect(wire).toBe(originalWire);
        expect(target.recordRejection('generation-1', id, 'forbidden')).toBe('rejected');
        if (handoff === 'throw') throw new Error('ambiguous after rejection');
        return handoff === 'true';
      });

      expect(result).toBe('rejected');
      expect(target.operation(id)).toMatchObject({
        clientOperationId: id,
        originalWire,
        status: 'rejected',
        rejection: 'forbidden',
        attempts: expectedAttempts,
        wasUncertain: false,
      });
      expect(target.releaseOperation(id, { discardDraft: true })).toBe(true);
    },
  );

  it.each([
    { handoff: 'false', expectedAttempts: 1 },
    { handoff: 'true', expectedAttempts: 2 },
    { handoff: 'throw', expectedAttempts: 2 },
  ] as const)(
    'preserves uncertainty and the latest rejection when retry handoff returns $handoff',
    ({ handoff, expectedAttempts }) => {
      const target = journal();
      const id = admit(target);
      const originalWire = target.operation(id)?.originalWire;
      expect(
        target.attemptOperation(id, () => {
          throw new Error('first ambiguous attempt');
        }),
      ).toBe('uncertain');

      const result = target.attemptOperation(id, (wire) => {
        expect(wire).toBe(originalWire);
        expect(target.recordRejection('generation-1', id, 'forbidden')).toBe('uncertain');
        if (handoff === 'throw') throw new Error('ambiguous after rejection');
        return handoff === 'true';
      });

      expect(result).toBe('uncertain');
      expect(target.operation(id)).toMatchObject({
        clientOperationId: id,
        originalWire,
        status: 'uncertain',
        rejection: 'forbidden',
        attempts: expectedAttempts,
        wasUncertain: true,
      });
      expect(target.releaseOperation(id, { discardDraft: true })).toBe(true);
    },
  );

  it.each([
    { handoff: 'false', expectedStatus: 'uncertain', expectedAttempts: 1, hasRejection: true },
    { handoff: 'true', expectedStatus: 'pending', expectedAttempts: 2, hasRejection: false },
    { handoff: 'throw', expectedStatus: 'uncertain', expectedAttempts: 2, hasRejection: true },
  ] as const)(
    'clears only a stale rejection when a clean uncertain retry returns $handoff',
    ({ handoff, expectedStatus, expectedAttempts, hasRejection }) => {
      const target = journal();
      const id = admit(target, { kind: 'remove', id: 'stable-element' });
      const admitted = target.operation(id);
      if (admitted === null) throw new Error('fixture');
      expect(
        target.attemptOperation(id, () => {
          throw new Error('first ambiguous attempt');
        }),
      ).toBe('uncertain');
      expect(target.recordRejection('generation-1', id, 'forbidden')).toBe('uncertain');
      expect(target.prepareRetry(id, 'generation-1', true)).toMatchObject({
        status: 'ready',
        clientOperationId: id,
        generation: admitted.generation,
        originalWire: admitted.originalWire,
        proposal: admitted.proposal,
      });

      const result = target.attemptOperation(id, (wire) => {
        expect(wire).toBe(admitted.originalWire);
        if (handoff === 'throw') throw new Error('second ambiguous attempt');
        return handoff === 'true';
      });
      const retained = target.operation(id);
      expect(result).toBe(expectedStatus);
      expect(retained).toMatchObject({
        clientOperationId: id,
        generation: admitted.generation,
        localSequence: admitted.localSequence,
        localEditGeneration: admitted.localEditGeneration,
        proposal: admitted.proposal,
        originalWire: admitted.originalWire,
        status: expectedStatus,
        attempts: expectedAttempts,
        wasUncertain: true,
      });
      expect(Object.hasOwn(retained ?? {}, 'rejection')).toBe(hasRejection);
      expect(retained?.rejection).toBe(hasRejection ? 'forbidden' : undefined);
      expect(target.releaseOperation(id, { discardDraft: true })).toBe(true);
    },
  );

  it.each([
    { handoff: 'false', expectedStatus: 'draft', expectedAttempts: 0 },
    { handoff: 'true', expectedStatus: 'uncertain', expectedAttempts: 1 },
    { handoff: 'throw', expectedStatus: 'uncertain', expectedAttempts: 1 },
  ] as const)(
    'applies lost-episode precedence when an initial handoff returns $handoff',
    ({ handoff, expectedStatus, expectedAttempts }) => {
      const target = journal();
      const id = admit(target);
      const result = target.attemptOperation(id, () => {
        target.markAttemptedUncertain();
        if (handoff === 'throw') throw new Error('lost episode during ambiguous handoff');
        return handoff === 'true';
      });

      expect(result).toBe(expectedStatus);
      expect(target.operation(id)).toMatchObject({
        status: expectedStatus,
        attempts: expectedAttempts,
        wasUncertain: expectedStatus === 'uncertain',
      });
      expect(target.releaseOperation(id, { discardDraft: true })).toBe(true);
    },
  );

  it.each([
    { handoff: 'false', expectedAttempts: 1 },
    { handoff: 'true', expectedAttempts: 2 },
    { handoff: 'throw', expectedAttempts: 2 },
  ] as const)(
    'keeps an uncertain retry uncertain when its episode is lost and handoff returns $handoff',
    ({ handoff, expectedAttempts }) => {
      const target = journal();
      const id = admit(target);
      const originalWire = target.operation(id)?.originalWire;
      expect(
        target.attemptOperation(id, () => {
          throw new Error('first ambiguous attempt');
        }),
      ).toBe('uncertain');
      const result = target.attemptOperation(id, (wire) => {
        expect(wire).toBe(originalWire);
        target.markAttemptedUncertain();
        if (handoff === 'throw') throw new Error('lost retry episode');
        return handoff === 'true';
      });

      expect(result).toBe('uncertain');
      expect(target.operation(id)).toMatchObject({
        clientOperationId: id,
        originalWire,
        status: 'uncertain',
        attempts: expectedAttempts,
        wasUncertain: true,
      });
      expect(target.releaseOperation(id, { discardDraft: true })).toBe(true);
    },
  );

  it.each([
    { handoff: 'false', expectedAttempts: 0 },
    { handoff: 'true', expectedAttempts: 1 },
    { handoff: 'throw', expectedAttempts: 1 },
  ] as const)(
    'keeps a reentrant receipt dominant when handoff returns $handoff',
    ({ handoff, expectedAttempts }) => {
      const target = journal();
      const id = admit(target);
      const result = target.attemptOperation(id, () => {
        receipt(target, id, `receipt-${handoff}`);
        target.markAttemptedUncertain();
        if (handoff === 'throw') throw new Error('ambiguous after receipt');
        return handoff === 'true';
      });

      expect(result).toBe('invalid');
      expect(target.operation(id)).toMatchObject({
        status: 'accepted',
        attempts: expectedAttempts,
        receipt: { receiptId: `receipt-${handoff}` },
      });
      expect(target.releaseOperation(id)).toBe(true);
    },
  );

  it('keeps an accepted receipt dominant over loss, rejection, ABA, and stale nested attempts', () => {
    const target = journal();
    const id = admit(target);
    const originalWire = target.operation(id)?.originalWire;
    expect(
      target.attemptOperation(id, () => {
        target.markAttemptedUncertain();
        expect(target.recordRejection('generation-1', id, 'forbidden')).toBe('rejected');
        receipt(target, id, 'receipt-dominant');
        expect(target.recordRejection('generation-1', id, 'conflict')).toBe('conflict');
        expect(target.setGeneration('generation-2')).toBe(true);
        expect(target.setGeneration('generation-1')).toBe(true);
        expect(target.attemptOperation(id, () => true)).toBe('invalid');
        return true;
      }),
    ).toBe('invalid');
    expect(target.operation(id)).toMatchObject({
      originalWire,
      status: 'accepted',
      attempts: 1,
      receipt: { receiptId: 'receipt-dominant' },
    });
    expect(target.releaseOperation(id)).toBe(true);
  });
});

describe('AuthorityClientJournal capacity and release', () => {
  it('accepts exactly 64 records, rejects one over atomically, and never evicts', () => {
    const target = journal();
    for (let index = 0; index < MAX_AUTHORITY_JOURNAL_OPERATIONS; index += 1) admit(target);
    const atLimit = target.stats();
    expect(atLimit.operationCount).toBe(MAX_AUTHORITY_JOURNAL_OPERATIONS);
    expect(target.admit({ kind: 'remove', id: 'one-over' })).toEqual({
      status: 'refused',
      reason: 'capacity',
    });
    expect(target.stats()).toEqual(atLimit);
    expect(target.operations()).toHaveLength(MAX_AUTHORITY_JOURNAL_OPERATIONS);
    expect(target.operations()[0]?.clientOperationId).toBe('op-001');
  });

  it('accepts exactly 4 MiB of original UTF-8 wire and rejects one byte over atomically', () => {
    const ids = ['large-0', 'large-1', 'large-2', 'large-3', 'small-00'];
    const target = journal({ operationId: () => ids.shift() ?? 'unexpected' });
    for (const id of ['large-0', 'large-1', 'large-2', 'large-3']) {
      const mutation = oneFrameMutation(id);
      expect(admit(target, mutation)).toBe(id);
      expect(target.operation(id)?.originalWire.length).toBe(MAX_AUTHORITY_FRAME_BYTES);
    }
    expect(target.stats().originalWireBytes).toBe(MAX_AUTHORITY_JOURNAL_BYTES);
    const atLimit = target.stats();
    expect(target.admit({ kind: 'remove', id: 'one-over' })).toEqual({
      status: 'refused',
      reason: 'capacity',
    });
    expect(target.stats()).toEqual(atLimit);
  });

  it('accounts UTF-8 bytes rather than UTF-16 code units', () => {
    const target = journal();
    const id = admit(target, {
      kind: 'extension',
      extensionKind: 'unicode',
      payload: '🙂',
    });
    const wire = target.operation(id)?.originalWire;
    if (wire === undefined) throw new Error('fixture');
    expect(target.stats().originalWireBytes).toBe(encoder.encode(wire).length);
    expect(target.stats().originalWireBytes).toBeGreaterThan(wire.length);
  });

  it('releases accepted records only unpinned and requires explicit discard for all others', () => {
    const target = journal();
    const draft = admit(target);
    expect(target.releaseOperation(draft)).toBe(false);
    const barrier = target.captureBarrier();
    if (barrier === null) throw new Error('fixture');
    expect(target.releaseOperation(draft, { discardDraft: true })).toBe(false);
    expect(target.releaseBarrier(barrier)).toBe(true);
    expect(target.releaseOperation(draft, { discardDraft: true })).toBe(true);
    expect(target.releaseOperation(draft, { discardDraft: true })).toBe(false);

    const accepted = admit(target);
    receipt(target, accepted);
    expect(target.releaseOperation(accepted)).toBe(true);

    for (const status of ['pending', 'rejected', 'uncertain'] as const) {
      const id = admit(target);
      target.attemptOperation(id, () => {
        if (status === 'uncertain') throw new Error('ambiguous');
        return true;
      });
      if (status === 'rejected') target.recordRejection('generation-1', id, 'forbidden');
      expect(target.releaseOperation(id)).toBe(false);
      expect(target.releaseOperation(id, { discardDraft: true })).toBe(true);
    }
    expect(target.stats().operationCount).toBe(0);
    expect(target.stats().originalWireBytes).toBe(0);
  });
});

describe('AuthorityClientJournal barriers', () => {
  it('captures absent generations, immutable cutoffs, and advances edit generations only on success', () => {
    const target = new AuthorityClientJournal({
      scopeId: 'room:a',
      createOperationId: idFactory(),
      createBarrierId: idFactory('barrier'),
    });
    const absent = target.captureBarrier();
    if (absent === null) throw new Error('fixture');
    expect(absent).toMatchObject({
      generation: null,
      throughLocalSequence: 0,
      localEditGeneration: 0,
      operationIds: [],
    });
    expect(target.stats().localEditGeneration).toBe(1);
    expect(target.setGeneration('generation-1')).toBe(true);
    const id = admit(target);
    expect(target.operation(id)?.localEditGeneration).toBe(1);
    const known = target.captureBarrier();
    expect(known).toMatchObject({
      generation: 'generation-1',
      throughLocalSequence: 1,
      localEditGeneration: 1,
      operationIds: [id],
    });
  });

  it('enforces 16 active barriers and 1,024 total references at exact boundaries', () => {
    const target = journal();
    for (let index = 0; index < MAX_AUTHORITY_JOURNAL_OPERATIONS; index += 1) admit(target);
    const barriers = [];
    for (let index = 0; index < MAX_AUTHORITY_BARRIERS; index += 1) {
      const barrier = target.captureBarrier();
      if (barrier === null) throw new Error('unexpected barrier refusal');
      barriers.push(barrier);
    }
    expect(target.stats()).toMatchObject({
      barrierCount: MAX_AUTHORITY_BARRIERS,
      barrierReferences: MAX_AUTHORITY_BARRIER_REFERENCES,
      localEditGeneration: MAX_AUTHORITY_BARRIERS,
    });
    const atLimit = target.stats();
    expect(target.captureBarrier()).toBeNull();
    expect(target.stats()).toEqual(atLimit);
    for (const barrier of barriers) expect(target.releaseBarrier(barrier)).toBe(true);
    expect(target.stats()).toMatchObject({ barrierCount: 0, barrierReferences: 0 });
  });

  it('rejects duplicate and thrown barrier IDs without pins or generation drift', () => {
    const ids: (string | Error)[] = ['same', 'same', new Error('failed')];
    const target = journal({
      barrierId: () => {
        const next = ids.shift();
        if (next instanceof Error) throw next;
        return next ?? 'fallback';
      },
    });
    const operation = admit(target);
    const first = target.captureBarrier();
    if (first === null) throw new Error('fixture');
    const before = target.stats();
    expect(target.captureBarrier()).toBeNull();
    expect(target.stats()).toEqual(before);
    expect(target.releaseBarrier(first)).toBe(true);
    expect(target.captureBarrier()).toBeNull();
    expect(target.releaseOperation(operation, { discardDraft: true })).toBe(true);
  });

  it('refuses operation IDs that reentrantly stop or replace the captured generation', () => {
    const stopped = new AuthorityClientJournal({
      scopeId: 'room:a',
      createOperationId: () => {
        stopped.stop();
        return 'after-stop';
      },
      createBarrierId: idFactory('barrier'),
    });
    stopped.setGeneration('generation-1');
    const stoppedBefore = stopped.stats();
    expect(stopped.admit({ kind: 'remove', id: 'element' })).toEqual({
      status: 'refused',
      reason: 'stopped',
    });
    expect(stopped.stats()).toEqual({ ...stoppedBefore, stopped: true });
    expect(stopped.operations()).toEqual([]);

    const replaced = new AuthorityClientJournal({
      scopeId: 'room:a',
      createOperationId: () => {
        replaced.setGeneration('generation-2');
        return 'stale-generation';
      },
      createBarrierId: idFactory('barrier'),
    });
    replaced.setGeneration('generation-1');
    const replacedBefore = replaced.stats();
    expect(replaced.admit({ kind: 'remove', id: 'element' })).toEqual({
      status: 'refused',
      reason: 'invalid',
    });
    expect(replaced.stats()).toEqual(replacedBefore);
    expect(replaced.generation).toBe('generation-2');
    expect(replaced.operations()).toEqual([]);
  });

  it('refuses barrier IDs that reentrantly stop or replace the captured generation', () => {
    const stopped = new AuthorityClientJournal({
      scopeId: 'room:a',
      createOperationId: idFactory(),
      createBarrierId: () => {
        stopped.stop();
        return 'after-stop';
      },
    });
    stopped.setGeneration('generation-1');
    const stoppedId = admit(stopped);
    const stoppedBefore = stopped.stats();
    expect(stopped.captureBarrier()).toBeNull();
    expect(stopped.stats()).toEqual({ ...stoppedBefore, stopped: true });
    expect(stopped.releaseOperation(stoppedId, { discardDraft: true })).toBe(true);

    const replaced = new AuthorityClientJournal({
      scopeId: 'room:a',
      createOperationId: idFactory(),
      createBarrierId: () => {
        replaced.setGeneration('generation-2');
        return 'stale-generation';
      },
    });
    replaced.setGeneration('generation-1');
    const replacedId = admit(replaced);
    const replacedBefore = replaced.stats();
    expect(replaced.captureBarrier()).toBeNull();
    expect(replaced.stats()).toEqual(replacedBefore);
    expect(replaced.generation).toBe('generation-2');
    expect(replaced.releaseOperation(replacedId, { discardDraft: true })).toBe(true);
  });

  it('rejects generation ABA from operation factories and proposal option access atomically', () => {
    const factory = new AuthorityClientJournal({
      scopeId: 'room:a',
      createOperationId: () => {
        factory.setGeneration('generation-2');
        factory.setGeneration('generation-1');
        return 'aba-operation';
      },
      createBarrierId: idFactory('barrier'),
    });
    factory.setGeneration('generation-1');
    const factoryBefore = factory.stats();
    expect(factory.admit({ kind: 'remove', id: 'element' })).toEqual({
      status: 'refused',
      reason: 'invalid',
    });
    expect(factory.stats()).toEqual(factoryBefore);
    expect(factory.generation).toBe('generation-1');
    expect(factory.operations()).toEqual([]);

    const options = journal();
    const optionsBefore = options.stats();
    const reentrantOptions = Object.defineProperty({}, 'expectedState', {
      enumerable: true,
      get: () => {
        options.setGeneration('generation-2');
        options.setGeneration('generation-1');
        return 'cas';
      },
    }) as { readonly expectedState: string };
    expect(options.admit({ kind: 'remove', id: 'element' }, reentrantOptions)).toEqual({
      status: 'refused',
      reason: 'invalid',
    });
    expect(options.stats()).toEqual(optionsBefore);
    expect(options.operations()).toEqual([]);
  });

  it('rejects generation ABA from barrier factories without resource or pin drift', () => {
    const target = new AuthorityClientJournal({
      scopeId: 'room:a',
      createOperationId: idFactory(),
      createBarrierId: () => {
        target.setGeneration('generation-2');
        target.setGeneration('generation-1');
        return 'aba-barrier';
      },
    });
    target.setGeneration('generation-1');
    const id = admit(target);
    const before = target.stats();
    expect(target.captureBarrier()).toBeNull();
    expect(target.stats()).toEqual(before);
    expect(target.generation).toBe('generation-1');
    expect(target.releaseOperation(id, { discardDraft: true })).toBe(true);
    expect(target.stats()).toMatchObject({
      operationCount: 0,
      originalWireBytes: 0,
      barrierCount: 0,
      barrierReferences: 0,
      localSequence: 1,
      localEditGeneration: 0,
    });
  });
});

describe('AuthorityClientJournal acknowledgement waiters', () => {
  it('partitions accepted, rejected, uncertain, and draft records into a blocking result', async () => {
    const target = journal();
    const accepted = admit(target);
    receipt(target, accepted);
    const rejected = admit(target);
    target.attemptOperation(rejected, () => true);
    target.recordRejection('generation-1', rejected, 'forbidden');
    const uncertain = admit(target);
    target.attemptOperation(uncertain, () => {
      throw new Error('ambiguous');
    });
    const draft = admit(target);
    const barrier = target.captureBarrier();
    if (barrier === null) throw new Error('fixture');
    await expect(target.waitForAcknowledgements(barrier)).resolves.toEqual({
      status: 'blocked',
      barrier,
      accepted: [target.operation(accepted)?.receipt],
      rejectedIds: [rejected],
      uncertainIds: [uncertain],
      outstandingIds: [draft],
    });
  });

  it('waits for pending records, pins while active, then settles acknowledged and cleans pins', async () => {
    const target = journal();
    const id = admit(target);
    target.attemptOperation(id, () => true);
    const barrier = target.captureBarrier();
    if (barrier === null) throw new Error('fixture');
    const waiting = target.waitForAcknowledgements(barrier);
    expect(target.stats().waiterCount).toBe(1);
    expect(target.releaseBarrier(barrier)).toBe(false);
    expect(target.releaseOperation(id, { discardDraft: true })).toBe(false);
    receipt(target, id);
    const result = await waiting;
    expect(result).toMatchObject({
      status: 'acknowledged',
      accepted: [{ clientOperationId: id }],
      outstandingIds: [],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.accepted)).toBe(true);
    expect(Object.isFrozen(result.accepted[0])).toBe(true);
    expect(Object.isFrozen(result.outstandingIds)).toBe(true);
    expect(target.stats().waiterCount).toBe(0);
    expect(target.releaseBarrier(barrier)).toBe(true);
    expect(target.releaseOperation(id)).toBe(true);
  });

  it('returns the current partition on timeout and abort without false success', async () => {
    vi.useFakeTimers();
    try {
      const target = journal();
      const id = admit(target);
      target.attemptOperation(id, () => true);
      const barrier = target.captureBarrier();
      if (barrier === null) throw new Error('fixture');
      const timed = target.waitForAcknowledgements(barrier, { timeoutMs: 10 });
      await vi.advanceTimersByTimeAsync(10);
      await expect(timed).resolves.toMatchObject({
        status: 'timeout',
        outstandingIds: [id],
      });

      const controller = new AbortController();
      const aborted = target.waitForAcknowledgements(barrier, { signal: controller.signal });
      controller.abort();
      await expect(aborted).resolves.toMatchObject({
        status: 'aborted',
        outstandingIds: [id],
      });
      expect(target.stats().waiterCount).toBe(0);
      expect(target.releaseBarrier(barrier)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns invalid for forged, released, and malformed waits', async () => {
    const target = journal();
    const barrier = target.captureBarrier();
    if (barrier === null) throw new Error('fixture');
    await expect(target.waitForAcknowledgements(barrier, { timeoutMs: 0 })).resolves.toMatchObject({
      status: 'invalid',
    });
    expect(target.releaseBarrier(barrier)).toBe(true);
    await expect(target.waitForAcknowledgements(barrier)).resolves.toEqual({
      status: 'invalid',
      barrier,
      accepted: [],
      rejectedIds: [],
      uncertainIds: [],
      outstandingIds: [],
    });
    const other = journal().captureBarrier();
    if (other === null) throw new Error('fixture');
    await expect(target.waitForAcknowledgements(other)).resolves.toMatchObject({
      status: 'invalid',
    });
  });

  it('deeply freezes bounded copies for forged, foreign, and released invalid barriers', async () => {
    const target = journal();
    const forgedIds = ['forged-operation'];
    const forged: AuthorityBarrier = {
      barrierId: 'forged',
      scopeId: 'room:forged',
      generation: 'generation-1',
      throughLocalSequence: 1,
      localEditGeneration: 1,
      operationIds: forgedIds,
    };
    const forgedResult = await target.waitForAcknowledgements(forged);
    expect(forgedResult.status).toBe('invalid');
    expect(forgedResult.barrier).not.toBe(forged);
    expect(forgedResult.barrier.operationIds).toEqual(['forged-operation']);
    expect(Object.isFrozen(forgedResult.barrier)).toBe(true);
    expect(Object.isFrozen(forgedResult.barrier.operationIds)).toBe(true);
    forgedIds.push('caller-mutation');
    expect(forgedResult.barrier.operationIds).toEqual(['forged-operation']);
    expect(() => {
      (forgedResult.barrier.operationIds as string[]).push('result-mutation');
    }).toThrow(TypeError);

    const foreign = journal().captureBarrier();
    if (foreign === null) throw new Error('fixture');
    const foreignResult = await target.waitForAcknowledgements(foreign);
    expect(foreignResult.status).toBe('invalid');
    expect(Object.isFrozen(foreignResult.barrier)).toBe(true);
    expect(Object.isFrozen(foreignResult.barrier.operationIds)).toBe(true);

    const released = target.captureBarrier();
    if (released === null) throw new Error('fixture');
    expect(target.releaseBarrier(released)).toBe(true);
    const releasedResult = await target.waitForAcknowledgements(released);
    expect(releasedResult.status).toBe('invalid');
    expect(Object.isFrozen(releasedResult.barrier)).toBe(true);
    expect(Object.isFrozen(releasedResult.barrier.operationIds)).toBe(true);
  });

  it('bounds hostile and oversized forged barriers without traversing caller data', async () => {
    const target = journal();
    const getterBarrier = {
      get barrierId(): string {
        throw new Error('hostile barrier getter');
      },
    } as AuthorityBarrier;
    const getterResult = await target.waitForAcknowledgements(getterBarrier);
    expect(getterResult).toMatchObject({
      status: 'invalid',
      barrier: { operationIds: [] },
    });

    const hostile = new Proxy({} as AuthorityBarrier, {
      getOwnPropertyDescriptor: () => {
        throw new Error('hostile barrier descriptor');
      },
      get: () => {
        throw new Error('hostile barrier getter');
      },
    });
    const hostileResult = await target.waitForAcknowledgements(hostile);
    expect(hostileResult).toMatchObject({
      status: 'invalid',
      barrier: { operationIds: [] },
    });
    expect(Object.isFrozen(hostileResult.barrier)).toBe(true);
    expect(Object.isFrozen(hostileResult.barrier.operationIds)).toBe(true);

    const oversizedIds: string[] = [];
    oversizedIds.length = 1_000_000_000;
    const oversized: AuthorityBarrier = {
      barrierId: 'oversized',
      scopeId: 'room:oversized',
      generation: null,
      throughLocalSequence: 0,
      localEditGeneration: 0,
      operationIds: oversizedIds,
    };
    const oversizedResult = await target.waitForAcknowledgements(oversized);
    expect(oversizedResult).toMatchObject({
      status: 'invalid',
      barrier: { operationIds: [] },
    });
    expect(Object.isFrozen(oversizedResult.barrier.operationIds)).toBe(true);
  });

  it('settles all active waits on stop, remains idempotent, and ignores late outcomes', async () => {
    const target = journal();
    const id = admit(target);
    target.attemptOperation(id, () => true);
    const barrier = target.captureBarrier();
    if (barrier === null) throw new Error('fixture');
    const waiting = target.waitForAcknowledgements(barrier);
    target.stop();
    target.stop();
    target.dispose();
    await expect(waiting).resolves.toMatchObject({
      status: 'stopped',
      uncertainIds: [id],
    });
    const stoppedState = target.operations();
    expect(
      target.recordReceipt({
        generation: 'generation-1',
        clientOperationId: id,
        receiptId: 'late',
      }),
    ).toBe('ignored');
    expect(target.operations()).toEqual(stoppedState);
    expect(target.captureBarrier()).toBeNull();
    await expect(target.waitForAcknowledgements(barrier)).resolves.toMatchObject({
      status: 'stopped',
      uncertainIds: [id],
    });
  });

  it('treats a reentrant stop during a handoff callback as uncertain without leaking pins', () => {
    const target = journal();
    const id = admit(target);
    expect(
      target.attemptOperation(id, () => {
        target.stop();
        return true;
      }),
    ).toBe('uncertain');
    expect(target.operation(id)).toMatchObject({
      status: 'uncertain',
      attempts: 1,
      wasUncertain: true,
    });
    expect(target.releaseOperation(id, { discardDraft: true })).toBe(true);

    const unsent = journal();
    const unsentId = admit(unsent);
    expect(
      unsent.attemptOperation(unsentId, () => {
        unsent.stop();
        return false;
      }),
    ).toBe('draft');
    expect(unsent.operation(unsentId)).toMatchObject({
      status: 'draft',
      attempts: 0,
      wasUncertain: false,
    });
    expect(unsent.releaseOperation(unsentId, { discardDraft: true })).toBe(true);
  });

  it('shares the exact 32-waiter ceiling and releases every reservation on settlement', async () => {
    const budget = new AuthorityWaiterBudget();
    const target = journal({ waiterBudget: budget });
    const id = admit(target);
    target.attemptOperation(id, () => true);
    const barrier = target.captureBarrier();
    if (barrier === null) throw new Error('fixture');
    expect(budget.reserve()).toBe(true); // reserved for a later checkpoint caller
    const waiters = Array.from({ length: MAX_AUTHORITY_WAITERS - 1 }, () =>
      target.waitForAcknowledgements(barrier),
    );
    expect(budget.active).toBe(MAX_AUTHORITY_WAITERS);
    await expect(target.waitForAcknowledgements(barrier)).resolves.toMatchObject({
      status: 'capacity',
      outstandingIds: [id],
    });
    budget.release();
    waiters.push(target.waitForAcknowledgements(barrier));
    expect(budget.active).toBe(MAX_AUTHORITY_WAITERS);
    receipt(target, id);
    const results = await Promise.all(waiters);
    expect(results.every((result) => result.status === 'acknowledged')).toBe(true);
    expect(budget.active).toBe(0);
    expect(target.stats().waiterCount).toBe(0);
  });

  it('cleans reservations and pins when a signal callback throws', async () => {
    const budget = new AuthorityWaiterBudget();
    const target = journal({ waiterBudget: budget });
    const id = admit(target);
    target.attemptOperation(id, () => true);
    const barrier = target.captureBarrier();
    if (barrier === null) throw new Error('fixture');
    const hostileSignal = {
      aborted: false,
      addEventListener: () => {
        throw new Error('listener callback failed');
      },
      removeEventListener: () => undefined,
    } as unknown as AbortSignal;
    await expect(
      target.waitForAcknowledgements(barrier, { signal: hostileSignal }),
    ).resolves.toMatchObject({ status: 'invalid', outstandingIds: [id] });
    expect(budget.active).toBe(0);
    expect(target.stats().waiterCount).toBe(0);
    expect(target.releaseBarrier(barrier)).toBe(true);
    expect(target.releaseOperation(id, { discardDraft: true })).toBe(true);
  });

  it('contains hostile signal getters and proxies before reserving waiter resources', async () => {
    const budget = new AuthorityWaiterBudget();
    const target = journal({ waiterBudget: budget });
    const id = admit(target);
    target.attemptOperation(id, () => true);
    const barrier = target.captureBarrier();
    if (barrier === null) throw new Error('fixture');

    const getterSignal = Object.defineProperty({}, 'aborted', {
      get: () => {
        throw new Error('hostile aborted getter');
      },
    }) as AbortSignal;
    let getterWait: Promise<AuthorityBarrierResult> | undefined;
    expect(() => {
      getterWait = target.waitForAcknowledgements(barrier, { signal: getterSignal });
    }).not.toThrow();
    if (getterWait === undefined) throw new Error('missing getter wait');
    await expect(getterWait).resolves.toMatchObject({ status: 'invalid', outstandingIds: [id] });

    const proxySignal = new Proxy(
      {
        aborted: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      } as unknown as AbortSignal,
      {
        get: (value, property, receiver) => {
          if (property === 'addEventListener') throw new Error('hostile signal proxy');
          return Reflect.get(value, property, receiver);
        },
      },
    );
    let proxyWait: Promise<AuthorityBarrierResult> | undefined;
    expect(() => {
      proxyWait = target.waitForAcknowledgements(barrier, { signal: proxySignal });
    }).not.toThrow();
    if (proxyWait === undefined) throw new Error('missing proxy wait');
    await expect(proxyWait).resolves.toMatchObject({ status: 'invalid', outstandingIds: [id] });

    expect(budget.active).toBe(0);
    expect(target.stats().waiterCount).toBe(0);
    expect(target.releaseBarrier(barrier)).toBe(true);
    expect(target.releaseOperation(id, { discardDraft: true })).toBe(true);
  });

  it('cleans synchronous abort callbacks without leaving a timer or pin', async () => {
    vi.useFakeTimers();
    try {
      const budget = new AuthorityWaiterBudget();
      const target = journal({ waiterBudget: budget });
      const id = admit(target);
      target.attemptOperation(id, () => true);
      const barrier = target.captureBarrier();
      if (barrier === null) throw new Error('fixture');
      const synchronousSignal = {
        aborted: false,
        addEventListener: (_type: string, listener: () => void) => listener(),
        removeEventListener: () => undefined,
      } as unknown as AbortSignal;
      await expect(
        target.waitForAcknowledgements(barrier, { signal: synchronousSignal }),
      ).resolves.toMatchObject({ status: 'aborted', outstandingIds: [id] });
      expect(vi.getTimerCount()).toBe(0);
      expect(budget.active).toBe(0);
      expect(target.stats().waiterCount).toBe(0);
      expect(target.releaseBarrier(barrier)).toBe(true);
      expect(target.releaseOperation(id, { discardDraft: true })).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('observes aborts triggered while signal methods are captured', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const budget = new AuthorityWaiterBudget();
      const target = journal({ waiterBudget: budget });
      const id = admit(target);
      target.attemptOperation(id, () => true);
      const barrier = target.captureBarrier();
      if (barrier === null) throw new Error('fixture');
      const captureSignal = {
        get aborted(): boolean {
          return controller.signal.aborted;
        },
        get addEventListener(): AbortSignal['addEventListener'] {
          controller.abort();
          return controller.signal.addEventListener.bind(controller.signal);
        },
        removeEventListener: controller.signal.removeEventListener.bind(controller.signal),
      } as AbortSignal;
      const waiting = target.waitForAcknowledgements(barrier, {
        signal: captureSignal,
        timeoutMs: 5,
      });
      await vi.advanceTimersByTimeAsync(5);
      const result = await waiting;
      expect(result).toMatchObject({ status: 'aborted', outstandingIds: [id] });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.outstandingIds)).toBe(true);
      expect(budget.active).toBe(0);
      expect(target.stats().waiterCount).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(target.releaseBarrier(barrier)).toBe(true);
      expect(target.releaseOperation(id, { discardDraft: true })).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('observes aborts and hostile rechecks after listener registration', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const budget = new AuthorityWaiterBudget();
      const target = journal({ waiterBudget: budget });
      const id = admit(target);
      target.attemptOperation(id, () => true);
      const barrier = target.captureBarrier();
      if (barrier === null) throw new Error('fixture');
      const registrationSignal = {
        get aborted(): boolean {
          return controller.signal.aborted;
        },
        addEventListener: (
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions,
        ) => {
          controller.abort();
          controller.signal.addEventListener(type, listener, options);
        },
        removeEventListener: controller.signal.removeEventListener.bind(controller.signal),
      } as AbortSignal;
      const waiting = target.waitForAcknowledgements(barrier, {
        signal: registrationSignal,
        timeoutMs: 5,
      });
      await vi.advanceTimersByTimeAsync(5);
      await expect(waiting).resolves.toMatchObject({ status: 'aborted', outstandingIds: [id] });
      expect(budget.active).toBe(0);
      expect(target.stats().waiterCount).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(target.releaseBarrier(barrier)).toBe(true);
      expect(target.releaseOperation(id, { discardDraft: true })).toBe(true);

      let registered = false;
      const hostileBudget = new AuthorityWaiterBudget();
      const hostile = journal({ waiterBudget: hostileBudget });
      const hostileId = admit(hostile);
      hostile.attemptOperation(hostileId, () => true);
      const hostileBarrier = hostile.captureBarrier();
      if (hostileBarrier === null) throw new Error('fixture');
      const hostileSignal = {
        get aborted(): boolean {
          if (registered) throw new Error('hostile abort recheck');
          return false;
        },
        addEventListener: () => {
          registered = true;
        },
        removeEventListener: () => undefined,
      } as unknown as AbortSignal;
      const hostileWaiting = hostile.waitForAcknowledgements(hostileBarrier, {
        signal: hostileSignal,
        timeoutMs: 5,
      });
      await vi.advanceTimersByTimeAsync(5);
      await expect(hostileWaiting).resolves.toMatchObject({
        status: 'invalid',
        outstandingIds: [hostileId],
      });
      expect(hostileBudget.active).toBe(0);
      expect(hostile.stats().waiterCount).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(hostile.releaseBarrier(hostileBarrier)).toBe(true);
      expect(hostile.releaseOperation(hostileId, { discardDraft: true })).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    'timeoutMs',
    'signal',
    'aborted-first',
    'addEventListener',
    'removeEventListener',
    'aborted-second',
    'proxy-addEventListener',
  ] as const)(
    'returns invalid with no owned resources when %s capture releases the barrier',
    async (boundary) => {
      vi.useFakeTimers();
      try {
        const budget = new AuthorityWaiterBudget();
        const target = journal({ waiterBudget: budget });
        const id = admit(target);
        target.attemptOperation(id, () => true);
        const barrier = target.captureBarrier();
        if (barrier === null) throw new Error('fixture');
        let released = false;
        const release = (): void => {
          if (released) return;
          released = true;
          expect(target.releaseBarrier(barrier)).toBe(true);
        };
        let abortedReads = 0;
        const signal = {
          get aborted(): boolean {
            abortedReads += 1;
            if (boundary === 'aborted-first' && abortedReads === 1) release();
            if (boundary === 'aborted-second' && abortedReads === 2) release();
            return false;
          },
          get addEventListener(): AbortSignal['addEventListener'] {
            if (boundary === 'addEventListener') release();
            return () => undefined;
          },
          get removeEventListener(): AbortSignal['removeEventListener'] {
            if (boundary === 'removeEventListener') release();
            return () => undefined;
          },
        } as AbortSignal;
        const proxiedSignal = new Proxy(signal, {
          get: (value, property, receiver) => {
            if (boundary === 'proxy-addEventListener' && property === 'addEventListener') release();
            return Reflect.get(value, property, receiver);
          },
        });
        const options = {
          get timeoutMs(): number {
            if (boundary === 'timeoutMs') release();
            return 10;
          },
          get signal(): AbortSignal {
            if (boundary === 'signal') release();
            return boundary === 'proxy-addEventListener' ? proxiedSignal : signal;
          },
        };

        await expect(target.waitForAcknowledgements(barrier, options)).resolves.toEqual({
          status: 'invalid',
          barrier,
          accepted: [],
          rejectedIds: [],
          uncertainIds: [],
          outstandingIds: [],
        });
        expect(released).toBe(true);
        expect(budget.active).toBe(0);
        expect(target.stats()).toMatchObject({
          barrierCount: 0,
          barrierReferences: 0,
          waiterCount: 0,
        });
        expect(vi.getTimerCount()).toBe(0);
        expect(target.releaseOperation(id, { discardDraft: true })).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each([
    'timeoutMs',
    'signal',
    'aborted-first',
    'addEventListener',
    'removeEventListener',
    'aborted-second',
    'proxy-addEventListener',
  ] as const)(
    'returns stopped with no waiter reservation when %s capture stops the journal',
    async (boundary) => {
      vi.useFakeTimers();
      try {
        const budget = new AuthorityWaiterBudget();
        const target = journal({ waiterBudget: budget });
        const id = admit(target);
        target.attemptOperation(id, () => true);
        const barrier = target.captureBarrier();
        if (barrier === null) throw new Error('fixture');
        let stopped = false;
        const stop = (): void => {
          if (stopped) return;
          stopped = true;
          target.stop();
        };
        let abortedReads = 0;
        const signal = {
          get aborted(): boolean {
            abortedReads += 1;
            if (boundary === 'aborted-first' && abortedReads === 1) stop();
            if (boundary === 'aborted-second' && abortedReads === 2) stop();
            return false;
          },
          get addEventListener(): AbortSignal['addEventListener'] {
            if (boundary === 'addEventListener') stop();
            return () => undefined;
          },
          get removeEventListener(): AbortSignal['removeEventListener'] {
            if (boundary === 'removeEventListener') stop();
            return () => undefined;
          },
        } as AbortSignal;
        const proxiedSignal = new Proxy(signal, {
          get: (value, property, receiver) => {
            if (boundary === 'proxy-addEventListener' && property === 'addEventListener') stop();
            return Reflect.get(value, property, receiver);
          },
        });
        const options = {
          get timeoutMs(): number {
            if (boundary === 'timeoutMs') stop();
            return 10;
          },
          get signal(): AbortSignal {
            if (boundary === 'signal') stop();
            return boundary === 'proxy-addEventListener' ? proxiedSignal : signal;
          },
        };

        await expect(target.waitForAcknowledgements(barrier, options)).resolves.toMatchObject({
          status: 'stopped',
          uncertainIds: [id],
        });
        expect(stopped).toBe(true);
        expect(budget.active).toBe(0);
        expect(target.stats()).toMatchObject({
          barrierCount: 1,
          barrierReferences: 1,
          waiterCount: 0,
        });
        expect(vi.getTimerCount()).toBe(0);
        expect(target.releaseBarrier(barrier)).toBe(true);
        expect(target.releaseOperation(id, { discardDraft: true })).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('revalidates shared waiter capacity after caller-controlled option access', async () => {
    vi.useFakeTimers();
    try {
      const budget = new AuthorityWaiterBudget(1);
      const target = journal({ waiterBudget: budget });
      const id = admit(target);
      target.attemptOperation(id, () => true);
      const barrier = target.captureBarrier();
      if (barrier === null) throw new Error('fixture');
      const options = {
        get timeoutMs(): number {
          expect(budget.reserve()).toBe(true);
          return 10;
        },
      };

      await expect(target.waitForAcknowledgements(barrier, options)).resolves.toMatchObject({
        status: 'capacity',
        outstandingIds: [id],
      });
      expect(budget.active).toBe(1);
      expect(target.stats().waiterCount).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      budget.release();
      expect(target.releaseBarrier(barrier)).toBe(true);
      expect(target.releaseOperation(id, { discardDraft: true })).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('owns registration before hostile release and settles reentrant stop exactly once', async () => {
    vi.useFakeTimers();
    try {
      const releaseBudget = new AuthorityWaiterBudget();
      const releaseTarget = journal({ waiterBudget: releaseBudget });
      const releaseId = admit(releaseTarget);
      releaseTarget.attemptOperation(releaseId, () => true);
      const releaseBarrier = releaseTarget.captureBarrier();
      if (releaseBarrier === null) throw new Error('fixture');
      const releaseSignal = {
        aborted: false,
        addEventListener: () => {
          expect(releaseBudget.active).toBe(1);
          expect(releaseTarget.stats().waiterCount).toBe(1);
          expect(releaseTarget.releaseBarrier(releaseBarrier)).toBe(false);
        },
        removeEventListener: () => undefined,
      } as unknown as AbortSignal;
      const releasedWait = releaseTarget.waitForAcknowledgements(releaseBarrier, {
        signal: releaseSignal,
        timeoutMs: 10,
      });
      receipt(releaseTarget, releaseId);
      await expect(releasedWait).resolves.toMatchObject({ status: 'acknowledged' });
      expect(releaseBudget.active).toBe(0);
      expect(releaseTarget.stats().waiterCount).toBe(0);
      expect(releaseTarget.releaseBarrier(releaseBarrier)).toBe(true);
      expect(releaseTarget.releaseOperation(releaseId)).toBe(true);

      const stopBudget = new AuthorityWaiterBudget();
      const stopTarget = journal({ waiterBudget: stopBudget });
      const stopId = admit(stopTarget);
      stopTarget.attemptOperation(stopId, () => true);
      const stopBarrier = stopTarget.captureBarrier();
      if (stopBarrier === null) throw new Error('fixture');
      let removals = 0;
      const stopSignal = {
        aborted: false,
        addEventListener: () => {
          expect(stopBudget.active).toBe(1);
          expect(stopTarget.stats().waiterCount).toBe(1);
          stopTarget.stop();
        },
        removeEventListener: () => {
          removals += 1;
        },
      } as unknown as AbortSignal;
      await expect(
        stopTarget.waitForAcknowledgements(stopBarrier, { signal: stopSignal, timeoutMs: 10 }),
      ).resolves.toMatchObject({ status: 'stopped', uncertainIds: [stopId] });
      expect(removals).toBe(1);
      expect(stopBudget.active).toBe(0);
      expect(stopTarget.stats().waiterCount).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(stopTarget.releaseBarrier(stopBarrier)).toBe(true);
      expect(stopTarget.releaseOperation(stopId, { discardDraft: true })).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases every owned resource before containing a throwing listener removal', async () => {
    vi.useFakeTimers();
    try {
      const budget = new AuthorityWaiterBudget();
      const target = journal({ waiterBudget: budget });
      const id = admit(target);
      target.attemptOperation(id, () => true);
      const barrier = target.captureBarrier();
      if (barrier === null) throw new Error('fixture');
      const signal = {
        aborted: false,
        addEventListener: () => undefined,
        removeEventListener: () => {
          expect(budget.active).toBe(0);
          expect(target.stats().waiterCount).toBe(0);
          expect(target.releaseBarrier(barrier)).toBe(true);
          throw new Error('hostile removal');
        },
      } as unknown as AbortSignal;
      const waiting = target.waitForAcknowledgements(barrier, { signal, timeoutMs: 10 });
      receipt(target, id);
      await expect(waiting).resolves.toMatchObject({ status: 'acknowledged' });
      expect(budget.active).toBe(0);
      expect(target.stats()).toMatchObject({
        barrierCount: 0,
        barrierReferences: 0,
        waiterCount: 0,
      });
      expect(vi.getTimerCount()).toBe(0);
      expect(target.releaseOperation(id)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['abort', 'stop'] as const)(
    'detaches listeners registered after synchronous %s settlement without hidden growth',
    async (settlement) => {
      vi.useFakeTimers();
      try {
        const retainedListeners = new Set<() => void>();
        for (let iteration = 0; iteration < 40; iteration += 1) {
          const budget = new AuthorityWaiterBudget();
          const target = journal({ waiterBudget: budget });
          const id = admit(target);
          target.attemptOperation(id, () => true);
          const barrier = target.captureBarrier();
          if (barrier === null) throw new Error('fixture');
          const signal = {
            aborted: false,
            addEventListener: (_type: string, listener: () => void) => {
              if (settlement === 'abort') listener();
              else target.stop();
              retainedListeners.add(listener);
            },
            removeEventListener: (_type: string, listener: () => void) => {
              retainedListeners.delete(listener);
            },
          } as unknown as AbortSignal;

          const result = await target.waitForAcknowledgements(barrier, {
            signal,
            timeoutMs: 10,
          });
          expect(result).toMatchObject({
            status: settlement === 'abort' ? 'aborted' : 'stopped',
            [settlement === 'abort' ? 'outstandingIds' : 'uncertainIds']: [id],
          });
          expect(Object.isFrozen(result)).toBe(true);
          expect(Object.isFrozen(result.outstandingIds)).toBe(true);
          expect(Object.isFrozen(result.uncertainIds)).toBe(true);
          expect(retainedListeners.size).toBe(0);
          expect(budget.active).toBe(0);
          expect(target.stats()).toMatchObject({
            barrierCount: 1,
            barrierReferences: 1,
            waiterCount: 0,
          });
          expect(vi.getTimerCount()).toBe(0);
          expect(target.releaseBarrier(barrier)).toBe(true);
          expect(target.stats()).toMatchObject({
            barrierCount: 0,
            barrierReferences: 0,
            waiterCount: 0,
          });
          expect(target.releaseOperation(id, { discardDraft: true })).toBe(true);
        }
        expect(retainedListeners.size).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );
});
