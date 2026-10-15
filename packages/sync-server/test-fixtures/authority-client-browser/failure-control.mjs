const FAILURE_MODES = new Set(['reject', 'lose-response', 'checkpoint-failure']);
const ID_PATTERN = /^[\x20-\x7e]{1,128}$/;
const TOMBSTONE_LIMIT = 32;

const frozen = (value) => Object.freeze(value);
const validId = (value) => typeof value === 'string' && ID_PATTERN.test(value);
const exactRequest = (value, keys) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

function targetFor(request) {
  if (request.mode === 'checkpoint-failure') return request.targetEpisodeId;
  return request.targetOperationId;
}

export class DropControlAcknowledgement extends Error {
  constructor() {
    super('Synthetic control acknowledgement loss');
    this.name = 'DropControlAcknowledgement';
  }
}

export class FailureControlOwner {
  #state = frozen({ phase: 'absent' });
  #tombstones = new Map();
  #epoch = 0;
  #reservationSequence = 0;

  snapshot() {
    return this.#state;
  }

  #remember(controlId, value) {
    this.#tombstones.delete(controlId);
    this.#tombstones.set(controlId, frozen(value));
    while (this.#tombstones.size > TOMBSTONE_LIMIT)
      this.#tombstones.delete(this.#tombstones.keys().next().value);
  }

  diagnostics() {
    return frozen({ epoch: this.#epoch, tombstones: this.#tombstones.size });
  }

  arm({ controlId, mode, target, generation }) {
    const current = this.#state;
    if (current.phase !== 'absent') {
      if (
        current.phase === 'armed' &&
        current.controlId === controlId &&
        current.mode === mode &&
        current.target === target &&
        current.generation === generation
      )
        return frozen({ code: 'already-armed', state: current });
      return frozen({ code: 'owner-conflict' });
    }
    const tombstone = this.#tombstones.get(controlId);
    if (tombstone) return frozen({ code: 'owner-conflict' });
    this.#state = frozen({ phase: 'armed', controlId, mode, target, generation });
    return frozen({ code: 'armed', state: this.#state });
  }

  status(controlId) {
    const current = this.#state;
    if (current.phase !== 'absent') {
      if (current.controlId !== controlId) return frozen({ code: 'owner-mismatch' });
      return frozen({
        code: current.phase === 'armed' && current.restored ? 'armed-restored' : current.phase,
        state: current,
      });
    }
    const tombstone = this.#tombstones.get(controlId);
    return tombstone ?? frozen({ code: 'unknown-control' });
  }

  clear(controlId) {
    const current = this.#state;
    if (current.phase === 'reserved') {
      return frozen({
        code: current.controlId === controlId ? 'reservation-active' : 'owner-mismatch',
      });
    }
    if (current.phase === 'armed') {
      if (current.controlId !== controlId) return frozen({ code: 'owner-mismatch' });
      this.#state = frozen({ phase: 'absent' });
      const result = frozen({ code: 'cleared', controlId });
      this.#remember(controlId, result);
      return result;
    }
    const tombstone = this.#tombstones.get(controlId);
    if (tombstone) return tombstone;
    return frozen({ code: 'unknown-control' });
  }

  #reserve(targetKind, target) {
    const current = this.#state;
    if (current.phase === 'absent') return frozen({ code: 'unmatched' });
    const expectedKind = current.mode === 'checkpoint-failure' ? 'checkpoint' : 'proposal';
    if (expectedKind !== targetKind || current.target !== target)
      return frozen({ code: 'unmatched' });
    if (current.phase === 'reserved') return frozen({ code: 'reservation-active', state: current });
    const reservationId = `epoch:${this.#epoch}:reservation:${++this.#reservationSequence}:${current.controlId}`;
    this.#state = frozen({
      ...current,
      phase: 'reserved',
      reservationId,
      reservationEpoch: this.#epoch,
    });
    return frozen({ code: 'reserved', state: this.#state });
  }

  reserveProposal(operationId) {
    return this.#reserve('proposal', operationId);
  }

  reserveCheckpoint(episodeId) {
    return this.#reserve('checkpoint', episodeId);
  }

  finish(reservationId, outcome) {
    const current = this.#state;
    if (current.phase !== 'reserved' || current.reservationId !== reservationId) {
      const match = /^epoch:(\d+):reservation:/.exec(reservationId);
      if (match && Number(match[1]) < this.#epoch) return frozen({ code: 'stale-reset' });
      return frozen({ code: 'stale-reservation' });
    }
    if (outcome === 'restored') {
      this.#state = frozen({
        phase: 'armed',
        controlId: current.controlId,
        mode: current.mode,
        target: current.target,
        generation: current.generation,
        restored: true,
      });
      return frozen({ code: 'armed-restored', state: this.#state });
    }
    this.#state = frozen({ phase: 'absent' });
    const result = frozen({ code: 'consumed', controlId: current.controlId });
    this.#remember(current.controlId, result);
    return result;
  }

  reset() {
    const current = this.#state;
    this.#epoch++;
    if (current.phase === 'absent') return frozen({ code: 'absent' });
    this.#state = frozen({ phase: 'absent' });
    const result = frozen({ code: 'invalidated-reset', controlId: current.controlId });
    this.#remember(current.controlId, result);
    return result;
  }
}

export class ResetTransactionLedger {
  #results = new Map();
  constructor(limit = 16) {
    this.limit = limit;
  }
  get(resetId) {
    return this.#results.get(resetId);
  }
  record(resetId, result) {
    const value = frozen({ ...result });
    this.#results.delete(resetId);
    this.#results.set(resetId, value);
    while (this.#results.size > this.limit) this.#results.delete(this.#results.keys().next().value);
    return value;
  }
  diagnostics() {
    return frozen({ results: this.#results.size, limit: this.limit });
  }
}

export function createFailureControlRuntime({ owner, ledger, getGeneration, replaceAndSeed }) {
  const runtime = {
    owner,
    ledger,
    replacementLedger: new ResetTransactionLedger(),
    getGeneration,
    replaceAndSeed,
    activeMutation: null,
    queuedReset: null,
    diagnostics() {
      return frozen({
        activeMutation: runtime.activeMutation?.kind ?? null,
        queuedReset: runtime.queuedReset !== null,
        resetResults: runtime.ledger.diagnostics().results,
        replacementResults: runtime.replacementLedger.diagnostics().results,
      });
    },
  };
  return runtime;
}

const failure = (kind, code, extra = {}) => frozen({ ok: false, kind, code, ...extra });
const success = (kind, code, extra = {}) => frozen({ ok: true, kind, code, ...extra });

function validArmRequest(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    !validId(value.controlId) ||
    !FAILURE_MODES.has(value.mode) ||
    !validId(value.expectedGeneration)
  )
    return false;
  const target = targetFor(value);
  return validId(target);
}

function failureStatusResponse(kind, controlId, result) {
  if (['armed', 'reserved'].includes(result.code))
    return success(kind, result.code, {
      controlId,
      mode: result.state.mode,
      target: result.state.target,
      generation: result.state.generation,
    });
  if (['consumed', 'cleared', 'invalidated-reset'].includes(result.code))
    return success(kind, result.code, { controlId });
  if (result.code === 'armed-restored')
    return success(kind, result.code, {
      controlId,
      mode: result.state.mode,
      target: result.state.target,
      generation: result.state.generation,
    });
  return failure(kind, result.code, { controlId });
}

async function waitForMutation(runtime) {
  while (runtime.activeMutation) await runtime.activeMutation.promise;
}

function identityFailure(kind, code, idName, id, runtime) {
  return failure(kind, code, { [idName]: id, currentGeneration: runtime.getGeneration() });
}

function finishMutation(runtime, mutation) {
  if (runtime.activeMutation !== mutation) return;
  runtime.activeMutation = null;
  const queued = runtime.queuedReset;
  if (!queued) return;
  runtime.queuedReset = null;
  const next = startResetMutation(queued.value, runtime, true);
  void next.then(queued.resolve);
}

function startResetMutation(value, runtime, retainPreconditionFailure = false) {
  const kind = 'reset';
  const currentGeneration = runtime.getGeneration();
  if (currentGeneration !== value.expectedGeneration) {
    const result = failure(kind, 'stale-generation', {
      resetId: value.resetId,
      expectedGeneration: value.expectedGeneration,
      currentGeneration,
    });
    return Promise.resolve(
      retainPreconditionFailure ? runtime.ledger.record(value.resetId, result) : result,
    );
  }
  const mutation = {
    kind,
    id: value.resetId,
    expectedGeneration: value.expectedGeneration,
    promise: null,
  };
  mutation.promise = (async () => {
    runtime.owner.reset();
    try {
      const resultingGeneration = await runtime.replaceAndSeed();
      return runtime.ledger.record(
        value.resetId,
        success(kind, 'completed', {
          resetId: value.resetId,
          expectedGeneration: value.expectedGeneration,
          resultingGeneration,
        }),
      );
    } catch {
      return runtime.ledger.record(
        value.resetId,
        failure(kind, 'partial-failure', {
          resetId: value.resetId,
          expectedGeneration: value.expectedGeneration,
          currentGeneration: runtime.getGeneration(),
        }),
      );
    }
  })();
  runtime.activeMutation = mutation;
  void mutation.promise.then(() => finishMutation(runtime, mutation));
  return mutation.promise;
}

async function resetBegin(value, runtime) {
  const kind = 'reset';
  if (!validId(value.resetId) || !validId(value.expectedGeneration))
    return failure(kind, 'invalid-request');
  const retained = runtime.ledger.get(value.resetId);
  if (retained) {
    if (retained.expectedGeneration !== value.expectedGeneration)
      return identityFailure(kind, 'identity-mismatch', 'resetId', value.resetId, runtime);
    return frozen({ ...retained, kind });
  }
  const active = runtime.activeMutation;
  if (active?.kind === 'reset') {
    if (active.id !== value.resetId)
      return identityFailure(kind, 'reset-busy', 'resetId', value.resetId, runtime);
    if (active.expectedGeneration !== value.expectedGeneration)
      return identityFailure(kind, 'identity-mismatch', 'resetId', value.resetId, runtime);
    const result = await active.promise;
    return frozen({ ...result, kind });
  }
  if (active?.kind === 'generation-replace') {
    const queued = runtime.queuedReset;
    if (queued) {
      if (queued.value.resetId !== value.resetId)
        return identityFailure(kind, 'reset-busy', 'resetId', value.resetId, runtime);
      if (queued.value.expectedGeneration !== value.expectedGeneration)
        return identityFailure(kind, 'identity-mismatch', 'resetId', value.resetId, runtime);
      return frozen({ ...(await queued.promise), kind });
    }
    let resolve;
    const promise = new Promise((resolvePromise) => {
      resolve = resolvePromise;
    });
    runtime.queuedReset = { value: frozen({ ...value }), promise, resolve };
    return frozen({ ...(await promise), kind });
  }
  const result = await startResetMutation(value, runtime);
  if (value.dropAcknowledgement) throw new DropControlAcknowledgement();
  return result;
}

async function generationReplace(value, runtime) {
  const kind = 'generation-replace';
  if (
    !exactRequest(value, ['command', 'replaceId', 'expectedGeneration']) ||
    !validId(value.replaceId) ||
    !validId(value.expectedGeneration)
  )
    return failure(kind, 'invalid-request');
  const retained = runtime.replacementLedger.get(value.replaceId);
  if (retained) {
    if (retained.expectedGeneration !== value.expectedGeneration)
      return identityFailure(kind, 'identity-mismatch', 'replaceId', value.replaceId, runtime);
    return retained;
  }
  if (runtime.activeMutation) {
    if (runtime.activeMutation.kind !== kind || runtime.activeMutation.id !== value.replaceId)
      return identityFailure(kind, 'control-busy', 'replaceId', value.replaceId, runtime);
    if (runtime.activeMutation.expectedGeneration !== value.expectedGeneration)
      return identityFailure(kind, 'identity-mismatch', 'replaceId', value.replaceId, runtime);
    return runtime.activeMutation.promise;
  }
  const currentGeneration = runtime.getGeneration();
  if (currentGeneration !== value.expectedGeneration)
    return failure(kind, 'stale-generation', {
      replaceId: value.replaceId,
      expectedGeneration: value.expectedGeneration,
      currentGeneration,
    });
  const mutation = {
    kind,
    id: value.replaceId,
    expectedGeneration: value.expectedGeneration,
    promise: null,
  };
  mutation.promise = (async () => {
    runtime.owner.reset();
    try {
      const resultingGeneration = await runtime.replaceAndSeed();
      return runtime.replacementLedger.record(
        value.replaceId,
        success(kind, 'completed', {
          replaceId: value.replaceId,
          expectedGeneration: value.expectedGeneration,
          resultingGeneration,
        }),
      );
    } catch {
      return runtime.replacementLedger.record(
        value.replaceId,
        failure(kind, 'partial-failure', {
          replaceId: value.replaceId,
          expectedGeneration: value.expectedGeneration,
          currentGeneration: runtime.getGeneration(),
        }),
      );
    }
  })();
  runtime.activeMutation = mutation;
  void mutation.promise.then(() => finishMutation(runtime, mutation));
  return mutation.promise;
}

export async function handleControlCommand(value, runtime) {
  if (!value || typeof value !== 'object' || typeof value.command !== 'string')
    return failure('control', 'invalid-request');
  if (value.command === 'failure-arm') {
    if (!validArmRequest(value)) return failure('failure-arm', 'invalid-request');
    if (runtime.activeMutation)
      return failure('failure-arm', 'control-busy', { controlId: value.controlId });
    const currentGeneration = runtime.getGeneration();
    if (currentGeneration !== value.expectedGeneration)
      return failure('failure-arm', 'stale-generation', {
        controlId: value.controlId,
        expectedGeneration: value.expectedGeneration,
        currentGeneration,
      });
    const target = targetFor(value);
    const result = runtime.owner.arm({
      controlId: value.controlId,
      mode: value.mode,
      target,
      generation: currentGeneration,
    });
    if (result.code === 'owner-conflict')
      return failure('failure-arm', result.code, { controlId: value.controlId });
    const response = success('failure-arm', result.code, {
      controlId: value.controlId,
      mode: value.mode,
      target,
      generation: currentGeneration,
    });
    if (value.dropAcknowledgement) throw new DropControlAcknowledgement();
    return response;
  }
  if (value.command === 'failure-status') {
    if (!validId(value.controlId)) return failure('failure-status', 'invalid-request');
    await waitForMutation(runtime);
    return failureStatusResponse(
      'failure-status',
      value.controlId,
      runtime.owner.status(value.controlId),
    );
  }
  if (value.command === 'failure-clear') {
    if (!validId(value.controlId)) return failure('failure-clear', 'invalid-request');
    const response = failureStatusResponse(
      'failure-clear',
      value.controlId,
      runtime.owner.clear(value.controlId),
    );
    if (value.dropAcknowledgement) throw new DropControlAcknowledgement();
    return response;
  }
  if (value.command === 'reset-begin') return resetBegin(value, runtime);
  if (value.command === 'reset-status') {
    if (!validId(value.resetId) || !validId(value.expectedGeneration))
      return failure('reset-status', 'invalid-request');
    const queued = runtime.queuedReset;
    if (queued) {
      if (queued.value.resetId !== value.resetId)
        return failure('reset-status', 'reset-mismatch', {
          resetId: value.resetId,
          currentGeneration: runtime.getGeneration(),
        });
      if (queued.value.expectedGeneration !== value.expectedGeneration)
        return failure('reset-status', 'identity-mismatch', {
          resetId: value.resetId,
          currentGeneration: runtime.getGeneration(),
        });
      await queued.promise;
    } else if (runtime.activeMutation) {
      if (runtime.activeMutation.kind !== 'reset' || runtime.activeMutation.id !== value.resetId)
        return failure('reset-status', 'reset-mismatch', {
          resetId: value.resetId,
          currentGeneration: runtime.getGeneration(),
        });
      if (runtime.activeMutation.expectedGeneration !== value.expectedGeneration)
        return failure('reset-status', 'identity-mismatch', {
          resetId: value.resetId,
          currentGeneration: runtime.getGeneration(),
        });
      await runtime.activeMutation.promise;
    }
    const retained = runtime.ledger.get(value.resetId);
    if (retained) {
      if (retained.expectedGeneration !== value.expectedGeneration)
        return failure('reset-status', 'identity-mismatch', {
          resetId: value.resetId,
          currentGeneration: runtime.getGeneration(),
        });
      return frozen({ ...retained, kind: 'reset-status' });
    }
    const currentGeneration = runtime.getGeneration();
    return failure(
      'reset-status',
      value.expectedGeneration === currentGeneration ? 'unknown-reset' : 'expired',
      {
        resetId: value.resetId,
        currentGeneration,
      },
    );
  }
  if (value.command === 'generation-status') {
    await waitForMutation(runtime);
    return success('generation-status', 'current', {
      currentGeneration: runtime.getGeneration(),
    });
  }
  if (value.command === 'generation-replace') return generationReplace(value, runtime);
  return failure('control', 'unknown-command');
}

function episodeFrom(context) {
  const value = context?.authContext?.synthetic?.targetEpisodeId;
  return typeof value === 'string' ? value : null;
}

export function createFailureControlledDriver(base, runtime, hooks = {}) {
  return {
    head: (...args) => base.head(...args),
    async commit(...args) {
      if (runtime.activeMutation) return { status: 'rejected', reason: 'overloaded' };
      const operationId = args[1]?.proposal?.clientOperationId;
      const reserved = runtime.owner.reserveProposal(operationId);
      if (reserved.code === 'reservation-active')
        return { status: 'rejected', reason: 'overloaded' };
      if (reserved.code !== 'reserved') return base.commit(...args);
      const state = reserved.state;
      if (state.mode === 'reject') {
        runtime.owner.finish(state.reservationId, 'consumed');
        hooks.record?.('definite-rejection', { operationId });
        return { status: 'rejected', reason: 'forbidden' };
      }
      try {
        const result = await base.commit(...args);
        hooks.record?.('commit', {
          operationId,
          status: result.status,
          replayed: result.replayed ?? false,
        });
        if (result.status !== 'committed') {
          runtime.owner.finish(state.reservationId, 'restored');
          return result;
        }
        const finished = runtime.owner.finish(state.reservationId, 'consumed');
        if (finished.code === 'stale-reset') return result;
        hooks.record?.('response-lost', { operationId });
        throw new Error('Synthetic response loss after durable test commit');
      } catch (error) {
        if (runtime.owner.snapshot().phase === 'reserved')
          runtime.owner.finish(state.reservationId, 'restored');
        throw error;
      }
    },
    async checkpoint(...args) {
      if (runtime.activeMutation) throw new Error('Synthetic checkpoint control busy');
      const episodeId = episodeFrom(args[0]);
      const reserved = runtime.owner.reserveCheckpoint(episodeId);
      if (reserved.code === 'reservation-active')
        throw new Error('Synthetic checkpoint control busy');
      if (reserved.code !== 'reserved') return base.checkpoint(...args);
      const state = reserved.state;
      try {
        const capture = await base.checkpoint(...args);
        const finished = runtime.owner.finish(state.reservationId, 'consumed');
        if (finished.code === 'stale-reset') {
          await capture.release();
          throw new Error('Synthetic checkpoint invalidated by Reset');
        }
        hooks.record?.('extension-checkpoint-failure', { episodeId });
        return {
          ...capture,
          state: {
            ...capture.state,
            extensions: {
              ...capture.state.extensions,
              synthetic: { pluginName: 'sdk-e-browser-fixture', version: 1, data: 42 },
            },
          },
        };
      } catch (error) {
        if (runtime.owner.snapshot().phase === 'reserved')
          runtime.owner.finish(state.reservationId, 'restored');
        throw error;
      }
    },
    readAfter: (...args) => base.readAfter(...args),
    readEvidence: (...args) => base.readEvidence(...args),
    claimPublications: (...args) => base.claimPublications(...args),
    markPublished: (...args) => base.markPublished(...args),
  };
}
