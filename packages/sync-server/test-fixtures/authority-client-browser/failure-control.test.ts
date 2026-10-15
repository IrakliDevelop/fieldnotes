import { describe, expect, it, vi } from 'vitest';
import {
  DropControlAcknowledgement,
  FailureControlOwner,
  ResetTransactionLedger,
  createFailureControlledDriver,
  createFailureControlRuntime,
  handleControlCommand,
} from './failure-control.mjs';

const proposal = (clientOperationId = 'operation-1') => ({
  proposal: { clientOperationId },
});
const committed = (replayed = false) => ({
  status: 'committed',
  receipt: {},
  position: { generation: 'g1', revision: '1' },
  replayed,
});
const lease = () => ({
  position: { generation: 'g1', revision: '1' },
  state: { extensions: { synthetic: { pluginName: 'fixture', version: 1, data: 'ready' } } },
  expiresAt: Date.now() + 1_000,
  token: 'lease',
  release: vi.fn(async () => undefined),
});

const deferred = <T>() => {
  let resolve: (value: T | PromiseLike<T>) => void = () => {
    throw new Error('deferred promise was not initialized');
  };
  let reject: (reason?: unknown) => void = () => {
    throw new Error('deferred promise was not initialized');
  };
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

function harness() {
  let generation = 'g1';
  let replacements = 0;
  let failSeed = false;
  const owner = new FailureControlOwner();
  const ledger = new ResetTransactionLedger();
  const runtime = createFailureControlRuntime({
    owner,
    ledger,
    getGeneration: () => generation,
    replaceAndSeed: async () => {
      replacements++;
      generation = `g${replacements + 1}`;
      if (failSeed) throw new Error('seed failed');
      return generation;
    },
  });
  return {
    owner,
    ledger,
    runtime,
    command: (body: unknown) => handleControlCommand(body, runtime),
    generation: () => generation,
    replacements: () => replacements,
    failNextSeed: () => {
      failSeed = true;
    },
  };
}

describe('fixture failure-control protocol', () => {
  it('validates fixed schemas, idempotence, conflicts, exact status/clear, and tombstones', async () => {
    const value = harness();
    await expect(value.command({ command: 'failure-arm' })).resolves.toEqual({
      ok: false,
      kind: 'failure-arm',
      code: 'invalid-request',
    });
    await expect(
      value.command({
        command: 'failure-arm',
        controlId: 'c1',
        mode: 'reject',
        targetOperationId: 'op1',
        expectedGeneration: 'g1',
      }),
    ).resolves.toEqual({
      ok: true,
      kind: 'failure-arm',
      code: 'armed',
      controlId: 'c1',
      mode: 'reject',
      target: 'op1',
      generation: 'g1',
    });
    await expect(
      value.command({
        command: 'failure-arm',
        controlId: 'c1',
        mode: 'reject',
        targetOperationId: 'op1',
        expectedGeneration: 'g1',
      }),
    ).resolves.toMatchObject({ ok: true, code: 'already-armed' });
    await expect(
      value.command({
        command: 'failure-arm',
        controlId: 'c2',
        mode: 'lose-response',
        targetOperationId: 'op2',
        expectedGeneration: 'g1',
      }),
    ).resolves.toEqual({
      ok: false,
      kind: 'failure-arm',
      code: 'owner-conflict',
      controlId: 'c2',
    });
    await expect(value.command({ command: 'failure-status', controlId: 'wrong' })).resolves.toEqual(
      {
        ok: false,
        kind: 'failure-status',
        code: 'owner-mismatch',
        controlId: 'wrong',
      },
    );
    await expect(value.command({ command: 'failure-clear', controlId: 'c1' })).resolves.toEqual({
      ok: true,
      kind: 'failure-clear',
      code: 'cleared',
      controlId: 'c1',
    });
    await expect(value.command({ command: 'failure-status', controlId: 'c1' })).resolves.toEqual({
      ok: true,
      kind: 'failure-status',
      code: 'cleared',
      controlId: 'c1',
    });
    await expect(value.command({ command: 'failure-clear', controlId: 'c1' })).resolves.toEqual({
      ok: true,
      kind: 'failure-clear',
      code: 'cleared',
      controlId: 'c1',
    });
  });

  it('retains ownership when an arm acknowledgement is dropped and clears only the exact ID', async () => {
    const value = harness();
    await expect(
      value.command({
        command: 'failure-arm',
        controlId: 'dropped',
        mode: 'reject',
        targetOperationId: 'target',
        expectedGeneration: 'g1',
        dropAcknowledgement: true,
      }),
    ).rejects.toBeInstanceOf(DropControlAcknowledgement);
    expect(value.owner.snapshot()).toMatchObject({
      phase: 'armed',
      controlId: 'dropped',
      target: 'target',
    });
    await expect(
      value.command({ command: 'failure-clear', controlId: 'other' }),
    ).resolves.toMatchObject({ ok: false, code: 'owner-mismatch' });
    expect(value.owner.snapshot()).toMatchObject({ controlId: 'dropped' });
    await expect(
      value.command({ command: 'failure-clear', controlId: 'dropped' }),
    ).resolves.toMatchObject({ ok: true, code: 'cleared' });
  });

  it('rejects malformed IDs, modes, targets, reset requests, and unknown commands with fixed shapes', async () => {
    const value = harness();
    for (const body of [
      {
        command: 'failure-arm',
        controlId: '',
        mode: 'reject',
        targetOperationId: 'x',
        expectedGeneration: 'g1',
      },
      {
        command: 'failure-arm',
        controlId: 'x',
        mode: 'other',
        targetOperationId: 'x',
        expectedGeneration: 'g1',
      },
      {
        command: 'failure-arm',
        controlId: 'x',
        mode: 'reject',
        targetOperationId: '',
        expectedGeneration: 'g1',
      },
      {
        command: 'failure-arm',
        controlId: 'x',
        mode: 'reject',
        targetOperationId: 'x',
        expectedGeneration: '',
      },
    ])
      await expect(value.command(body)).resolves.toEqual({
        ok: false,
        kind: 'failure-arm',
        code: 'invalid-request',
      });
    await expect(value.command({ command: 'failure-status', controlId: '' })).resolves.toEqual({
      ok: false,
      kind: 'failure-status',
      code: 'invalid-request',
    });
    await expect(value.command({ command: 'failure-clear', controlId: '' })).resolves.toEqual({
      ok: false,
      kind: 'failure-clear',
      code: 'invalid-request',
    });
    await expect(
      value.command({ command: 'reset-begin', resetId: '', expectedGeneration: 'g1' }),
    ).resolves.toEqual({
      ok: false,
      kind: 'reset',
      code: 'invalid-request',
    });
    await expect(
      value.command({ command: 'reset-status', resetId: 'x', expectedGeneration: '' }),
    ).resolves.toEqual({
      ok: false,
      kind: 'reset-status',
      code: 'invalid-request',
    });
    await expect(value.command({ command: 'not-a-command' })).resolves.toEqual({
      ok: false,
      kind: 'control',
      code: 'unknown-command',
    });
    await expect(
      value.command({
        command: 'generation-replace',
        replaceId: 'replace',
        expectedGeneration: 'g1',
        extra: true,
      }),
    ).resolves.toEqual({
      ok: false,
      kind: 'generation-replace',
      code: 'invalid-request',
    });
  });

  it('reports reserved ownership, refuses clear, and rejects stale reservation IDs', () => {
    const owner = new FailureControlOwner();
    owner.arm({ controlId: 'c', mode: 'reject', target: 'target', generation: 'g1' });
    const reserved = owner.reserveProposal('target');
    expect(owner.status('c')).toMatchObject({ code: 'reserved' });
    expect(owner.clear('c')).toEqual({ code: 'reservation-active' });
    expect(owner.clear('other')).toEqual({ code: 'owner-mismatch' });
    expect(owner.finish('wrong', 'consumed')).toEqual({ code: 'stale-reservation' });
    expect(owner.finish(reserved.state.reservationId, 'consumed')).toMatchObject({
      code: 'consumed',
    });
    expect(owner.reserveProposal('target')).toEqual({ code: 'unmatched' });
  });

  it('covers exact terminal reuse, absent/reset, reserved/restored dispatcher, and dropped clear', async () => {
    const value = harness();
    expect(value.owner.status('unknown')).toEqual({ code: 'unknown-control' });
    expect(value.owner.clear('unknown')).toEqual({ code: 'unknown-control' });
    expect(value.owner.reset()).toEqual({ code: 'absent' });
    await value.command({
      command: 'failure-arm',
      controlId: 'reserved',
      mode: 'lose-response',
      targetOperationId: 'target',
      expectedGeneration: 'g1',
    });
    const reservation = value.owner.reserveProposal('target');
    await expect(
      value.command({ command: 'failure-status', controlId: 'reserved' }),
    ).resolves.toMatchObject({ ok: true, code: 'reserved', target: 'target' });
    value.owner.finish(reservation.state.reservationId, 'restored');
    await expect(
      value.command({ command: 'failure-status', controlId: 'reserved' }),
    ).resolves.toMatchObject({ ok: true, code: 'armed-restored', target: 'target' });
    await expect(
      value.command({
        command: 'failure-clear',
        controlId: 'reserved',
        dropAcknowledgement: true,
      }),
    ).rejects.toBeInstanceOf(DropControlAcknowledgement);
    await expect(
      value.command({
        command: 'failure-arm',
        controlId: 'reserved',
        mode: 'reject',
        targetOperationId: 'new-target',
        expectedGeneration: 'g1',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'owner-conflict' });
  });

  it('returns fixed invalid/unknown Reset status and delegates every uncontrolled driver method', async () => {
    const value = harness();
    await expect(value.command(null)).resolves.toEqual({
      ok: false,
      kind: 'control',
      code: 'invalid-request',
    });
    await expect(value.command({})).resolves.toEqual({
      ok: false,
      kind: 'control',
      code: 'invalid-request',
    });
    await expect(
      value.command({ command: 'reset-status', resetId: 'unknown', expectedGeneration: 'g1' }),
    ).resolves.toEqual({
      ok: false,
      kind: 'reset-status',
      code: 'unknown-reset',
      resetId: 'unknown',
      currentGeneration: 'g1',
    });
    const base = {
      head: vi.fn(async () => 'head'),
      commit: vi.fn(async () => ({ status: 'rejected', reason: 'invalid' })),
      checkpoint: vi.fn(async () => lease()),
      readAfter: vi.fn(async () => 'after'),
      readEvidence: vi.fn(async () => 'evidence'),
      claimPublications: vi.fn(async () => 'claims'),
      markPublished: vi.fn(async () => 'marked'),
    };
    const driver = createFailureControlledDriver(base, value.runtime);
    await expect(driver.head('head-context')).resolves.toBe('head');
    await expect(driver.commit({}, proposal('ordinary'))).resolves.toMatchObject({
      status: 'rejected',
    });
    await expect(driver.checkpoint({})).resolves.toMatchObject({ token: 'lease' });
    await expect(driver.readAfter('read')).resolves.toBe('after');
    await expect(driver.readEvidence('evidence')).resolves.toBe('evidence');
    await expect(driver.claimPublications('claims')).resolves.toBe('claims');
    await expect(driver.markPublished('marked')).resolves.toBe('marked');
  });

  it('does not synthesize response loss when Reset invalidates an in-flight durable commit', async () => {
    const value = harness();
    const pending = deferred<ReturnType<typeof committed>>();
    const base = {
      head: vi.fn(),
      commit: vi.fn(() => pending.promise),
      checkpoint: vi.fn(async () => lease()),
      readAfter: vi.fn(),
      readEvidence: vi.fn(),
      claimPublications: vi.fn(),
      markPublished: vi.fn(),
    };
    const driver = createFailureControlledDriver(base, value.runtime);
    await value.command({
      command: 'failure-arm',
      controlId: 'late-commit',
      mode: 'lose-response',
      targetOperationId: 'target',
      expectedGeneration: 'g1',
    });
    const commit = driver.commit({}, proposal('target'));
    await value.command({ command: 'reset-begin', resetId: 'reset', expectedGeneration: 'g1' });
    pending.resolve(committed());
    await expect(commit).resolves.toMatchObject({ status: 'committed' });
    expect(value.owner.status('late-commit')).toMatchObject({ code: 'invalidated-reset' });
  });

  it('recognizes the oldest durable proposal as Reset-stale after more than the retention bound', async () => {
    const value = harness();
    const pending = Array.from({ length: 40 }, () => deferred<ReturnType<typeof committed>>());
    let index = 0;
    const base = {
      head: vi.fn(),
      commit: vi.fn(() => pending[index++].promise),
      checkpoint: vi.fn(async () => lease()),
      readAfter: vi.fn(),
      readEvidence: vi.fn(),
      claimPublications: vi.fn(),
      markPublished: vi.fn(),
    };
    const driver = createFailureControlledDriver(base, value.runtime);
    const commits: Promise<unknown>[] = [];
    for (let sequence = 0; sequence < pending.length; sequence++) {
      const controlId = `late-${sequence}`;
      value.owner.arm({
        controlId,
        mode: 'lose-response',
        target: controlId,
        generation: 'g1',
      });
      commits.push(driver.commit({}, proposal(controlId)));
      expect(value.owner.reset()).toMatchObject({ code: 'invalidated-reset' });
    }
    pending[0].resolve(committed());
    await expect(commits[0]).resolves.toMatchObject({ status: 'committed' });
    expect(value.owner.diagnostics()).toEqual({ epoch: 40, tombstones: 32 });
  });

  it('releases the oldest Reset-stale checkpoint once after more than the retention bound', async () => {
    const value = harness();
    const pending = Array.from({ length: 40 }, () => deferred<ReturnType<typeof lease>>());
    let index = 0;
    const base = {
      head: vi.fn(),
      commit: vi.fn(async () => committed()),
      checkpoint: vi.fn(() => pending[index++].promise),
      readAfter: vi.fn(),
      readEvidence: vi.fn(),
      claimPublications: vi.fn(),
      markPublished: vi.fn(),
    };
    const driver = createFailureControlledDriver(base, value.runtime);
    const checkpoints: Promise<unknown>[] = [];
    for (let sequence = 0; sequence < pending.length; sequence++) {
      const controlId = `checkpoint-${sequence}`;
      value.owner.arm({
        controlId,
        mode: 'checkpoint-failure',
        target: controlId,
        generation: 'g1',
      });
      checkpoints.push(
        driver.checkpoint({ authContext: { synthetic: { targetEpisodeId: controlId } } }),
      );
      expect(value.owner.reset()).toMatchObject({ code: 'invalidated-reset' });
    }
    const oldest = lease();
    pending[0].resolve(oldest);
    await expect(checkpoints[0]).rejects.toThrow('Synthetic checkpoint invalidated by Reset');
    expect(oldest.release).toHaveBeenCalledTimes(1);
    expect(value.owner.diagnostics()).toEqual({ epoch: 40, tombstones: 32 });
  });

  it.each(['reject', 'lose-response', 'checkpoint-failure'] as const)(
    'generation-fences a delayed %s arm and lets a later arm succeed',
    async (mode) => {
      const value = harness();
      await value.command({ command: 'reset-begin', resetId: 'r1', expectedGeneration: 'g1' });
      const target =
        mode === 'checkpoint-failure'
          ? { targetEpisodeId: 'episode-old' }
          : { targetOperationId: 'operation-old' };
      await expect(
        value.command({
          command: 'failure-arm',
          controlId: `old-${mode}`,
          mode,
          ...target,
          expectedGeneration: 'g1',
        }),
      ).resolves.toEqual({
        ok: false,
        kind: 'failure-arm',
        code: 'stale-generation',
        controlId: `old-${mode}`,
        expectedGeneration: 'g1',
        currentGeneration: 'g2',
      });
      expect(value.owner.snapshot()).toEqual({ phase: 'absent' });
      await expect(
        value.command({
          command: 'failure-arm',
          controlId: `new-${mode}`,
          mode,
          ...(mode === 'checkpoint-failure'
            ? { targetEpisodeId: 'episode-new' }
            : { targetOperationId: 'operation-new' }),
          expectedGeneration: 'g2',
        }),
      ).resolves.toMatchObject({ ok: true, code: 'armed', generation: 'g2' });
    },
  );

  it('binds proposal failures, excludes same-target concurrency, and restores every noncommit/throw', async () => {
    const value = harness();
    const commit = vi.fn(async () => committed());
    const base = {
      head: vi.fn(),
      commit,
      checkpoint: vi.fn(async () => lease()),
      readAfter: vi.fn(),
      readEvidence: vi.fn(),
      claimPublications: vi.fn(),
      markPublished: vi.fn(),
    };
    const driver = createFailureControlledDriver(base, value.runtime);
    await value.command({
      command: 'failure-arm',
      controlId: 'reject',
      mode: 'reject',
      targetOperationId: 'target',
      expectedGeneration: 'g1',
    });
    await expect(driver.commit({}, proposal('other'))).resolves.toEqual(committed());
    expect(value.owner.snapshot()).toMatchObject({ phase: 'armed', controlId: 'reject' });
    await expect(driver.commit({}, proposal('target'))).resolves.toEqual({
      status: 'rejected',
      reason: 'forbidden',
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(value.owner.status('reject')).toMatchObject({ code: 'consumed' });

    for (const result of [
      { status: 'rejected', reason: 'conflict' },
      { status: 'rejected', reason: 'generation-mismatch' },
      { status: 'rejected', reason: 'expired' },
      { status: 'rejected', reason: 'invalid' },
      { status: 'rejected', reason: 'overloaded' },
    ]) {
      const controlId = `loss-${result.reason}`;
      await value.command({
        command: 'failure-arm',
        controlId,
        mode: 'lose-response',
        targetOperationId: controlId,
        expectedGeneration: 'g1',
      });
      commit.mockResolvedValueOnce(result as never);
      await expect(driver.commit({}, proposal(controlId))).resolves.toEqual(result);
      expect(value.owner.status(controlId)).toMatchObject({ code: 'armed-restored' });
      await value.command({ command: 'failure-clear', controlId });
    }
    await value.command({
      command: 'failure-arm',
      controlId: 'throw',
      mode: 'lose-response',
      targetOperationId: 'throw',
      expectedGeneration: 'g1',
    });
    commit.mockRejectedValueOnce(new Error('pre-durable'));
    await expect(driver.commit({}, proposal('throw'))).rejects.toThrow('pre-durable');
    expect(value.owner.status('throw')).toMatchObject({ code: 'armed-restored' });
  });

  it.each([false, true])(
    'loses a committed response after durability (replayed=%s)',
    async (replayed) => {
      const value = harness();
      const base = {
        head: vi.fn(),
        commit: vi.fn(async () => committed(replayed)),
        checkpoint: vi.fn(async () => lease()),
        readAfter: vi.fn(),
        readEvidence: vi.fn(),
        claimPublications: vi.fn(),
        markPublished: vi.fn(),
      };
      const driver = createFailureControlledDriver(base, value.runtime);
      await value.command({
        command: 'failure-arm',
        controlId: 'loss',
        mode: 'lose-response',
        targetOperationId: 'target',
        expectedGeneration: 'g1',
      });
      await expect(driver.commit({}, proposal('target'))).rejects.toThrow(
        'Synthetic response loss after durable test commit',
      );
      expect(value.owner.status('loss')).toMatchObject({ code: 'consumed' });
    },
  );

  it('rejects a concurrent same-target proposal before base while one response-loss commit is reserved', async () => {
    const value = harness();
    const pending = deferred<ReturnType<typeof committed>>();
    const commit = vi.fn(() => pending.promise);
    const base = {
      head: vi.fn(),
      commit,
      checkpoint: vi.fn(async () => lease()),
      readAfter: vi.fn(),
      readEvidence: vi.fn(),
      claimPublications: vi.fn(),
      markPublished: vi.fn(),
    };
    const driver = createFailureControlledDriver(base, value.runtime);
    await value.command({
      command: 'failure-arm',
      controlId: 'loss',
      mode: 'lose-response',
      targetOperationId: 'target',
      expectedGeneration: 'g1',
    });
    const first = driver.commit({}, proposal('target'));
    await expect(driver.commit({}, proposal('target'))).resolves.toEqual({
      status: 'rejected',
      reason: 'overloaded',
    });
    expect(commit).toHaveBeenCalledTimes(1);
    pending.resolve(committed());
    await expect(first).rejects.toThrow('Synthetic response loss');
  });

  it('corrupts one matching checkpoint, blocks same-episode concurrency, and restores on base throw', async () => {
    const value = harness();
    const pending = deferred<ReturnType<typeof lease>>();
    const checkpoint = vi.fn(() => pending.promise);
    const base = {
      head: vi.fn(),
      commit: vi.fn(async () => committed()),
      checkpoint,
      readAfter: vi.fn(),
      readEvidence: vi.fn(),
      claimPublications: vi.fn(),
      markPublished: vi.fn(),
    };
    const driver = createFailureControlledDriver(base, value.runtime);
    await value.command({
      command: 'failure-arm',
      controlId: 'checkpoint',
      mode: 'checkpoint-failure',
      targetEpisodeId: 'episode',
      expectedGeneration: 'g1',
    });
    const first = driver.checkpoint({ authContext: { synthetic: { targetEpisodeId: 'episode' } } });
    await expect(
      driver.checkpoint({ authContext: { synthetic: { targetEpisodeId: 'episode' } } }),
    ).rejects.toThrow('Synthetic checkpoint control busy');
    expect(checkpoint).toHaveBeenCalledTimes(1);
    const capture = lease();
    pending.resolve(capture);
    await expect(first).resolves.toMatchObject({
      state: { extensions: { synthetic: { data: 42 } } },
    });
    expect(value.owner.status('checkpoint')).toMatchObject({ code: 'consumed' });

    await value.command({
      command: 'failure-arm',
      controlId: 'checkpoint-throw',
      mode: 'checkpoint-failure',
      targetEpisodeId: 'episode-throw',
      expectedGeneration: 'g1',
    });
    checkpoint.mockRejectedValueOnce(new Error('checkpoint failed'));
    await expect(
      driver.checkpoint({
        authContext: { synthetic: { targetEpisodeId: 'episode-throw' } },
      }),
    ).rejects.toThrow('checkpoint failed');
    expect(value.owner.status('checkpoint-throw')).toMatchObject({ code: 'armed-restored' });
  });

  it('binds checkpoint failure to auth episode and releases a lease invalidated by Reset', async () => {
    const value = harness();
    const pending = deferred<ReturnType<typeof lease>>();
    const baseLease = lease();
    const base = {
      head: vi.fn(),
      commit: vi.fn(async () => committed()),
      checkpoint: vi.fn(() => pending.promise),
      readAfter: vi.fn(),
      readEvidence: vi.fn(),
      claimPublications: vi.fn(),
      markPublished: vi.fn(),
    };
    const driver = createFailureControlledDriver(base, value.runtime);
    await value.command({
      command: 'failure-arm',
      controlId: 'checkpoint',
      mode: 'checkpoint-failure',
      targetEpisodeId: 'episode',
      expectedGeneration: 'g1',
    });
    const unaffected = driver.checkpoint({
      authContext: { synthetic: { targetEpisodeId: 'old' } },
    });
    pending.resolve(baseLease);
    await expect(unaffected).resolves.toBe(baseLease);
    expect(value.owner.snapshot()).toMatchObject({ phase: 'armed' });

    const next = deferred<ReturnType<typeof lease>>();
    base.checkpoint.mockImplementationOnce(() => next.promise);
    const controlled = driver.checkpoint({
      authContext: { synthetic: { targetEpisodeId: 'episode' } },
    });
    await value.command({ command: 'reset-begin', resetId: 'r1', expectedGeneration: 'g1' });
    const obtained = lease();
    next.resolve(obtained);
    await expect(controlled).rejects.toThrow('Synthetic checkpoint invalidated by Reset');
    expect(obtained.release).toHaveBeenCalledTimes(1);
    expect(value.owner.status('checkpoint')).toMatchObject({ code: 'invalidated-reset' });
  });

  it('serializes Reset, records partial failure, retains sixteen results, and prevents old replay', async () => {
    const value = harness();
    value.failNextSeed();
    await expect(
      value.command({ command: 'reset-begin', resetId: 'partial', expectedGeneration: 'g1' }),
    ).resolves.toEqual({
      ok: false,
      kind: 'reset',
      code: 'partial-failure',
      resetId: 'partial',
      expectedGeneration: 'g1',
      currentGeneration: 'g2',
    });
    expect(value.replacements()).toBe(1);
    await expect(
      value.command({ command: 'reset-begin', resetId: 'partial', expectedGeneration: 'g1' }),
    ).resolves.toMatchObject({ code: 'partial-failure', currentGeneration: 'g2' });
    expect(value.replacements()).toBe(1);

    const clean = harness();
    for (let index = 0; index < 17; index++) {
      await clean.command({
        command: 'reset-begin',
        resetId: `r${index}`,
        expectedGeneration: `g${index + 1}`,
      });
    }
    expect(clean.replacements()).toBe(17);
    expect(clean.ledger.diagnostics()).toEqual({ results: 16, limit: 16 });
    await expect(
      clean.command({ command: 'reset-status', resetId: 'r0', expectedGeneration: 'g1' }),
    ).resolves.toEqual({
      ok: false,
      kind: 'reset-status',
      code: 'expired',
      resetId: 'r0',
      currentGeneration: 'g18',
    });
    await expect(
      clean.command({ command: 'reset-begin', resetId: 'r0', expectedGeneration: 'g1' }),
    ).resolves.toMatchObject({ code: 'stale-generation', currentGeneration: 'g18' });
    expect(clean.replacements()).toBe(17);
    await expect(clean.command({ command: 'generation-status' })).resolves.toEqual({
      ok: true,
      kind: 'generation-status',
      code: 'current',
      currentGeneration: 'g18',
    });
  });

  it('holds one mutation lane across delayed Reset seed and serializes status and same-ID replay', async () => {
    let generation = 'g1';
    const replacement = deferred<string>();
    const runtime = createFailureControlRuntime({
      owner: new FailureControlOwner(),
      ledger: new ResetTransactionLedger(),
      getGeneration: () => generation,
      replaceAndSeed: async () => {
        generation = 'g2';
        return replacement.promise;
      },
    });
    const reset = handleControlCommand(
      { command: 'reset-begin', resetId: 'r1', expectedGeneration: 'g1' },
      runtime,
    );
    await Promise.resolve();
    const base = {
      head: vi.fn(),
      commit: vi.fn(async () => committed()),
      checkpoint: vi.fn(async () => lease()),
      readAfter: vi.fn(),
      readEvidence: vi.fn(),
      claimPublications: vi.fn(),
      markPublished: vi.fn(),
    };
    const driver = createFailureControlledDriver(base, runtime);
    await expect(driver.commit({}, proposal('during-reset'))).resolves.toEqual({
      status: 'rejected',
      reason: 'overloaded',
    });
    await expect(driver.checkpoint({})).rejects.toThrow('Synthetic checkpoint control busy');
    expect(base.commit).not.toHaveBeenCalled();
    expect(base.checkpoint).not.toHaveBeenCalled();
    await expect(
      handleControlCommand(
        {
          command: 'failure-arm',
          controlId: 'blocked',
          mode: 'reject',
          targetOperationId: 'target',
          expectedGeneration: 'g1',
        },
        runtime,
      ),
    ).resolves.toMatchObject({ ok: false, code: 'control-busy' });
    await expect(
      handleControlCommand(
        { command: 'reset-begin', resetId: 'other', expectedGeneration: 'g1' },
        runtime,
      ),
    ).resolves.toMatchObject({ ok: false, code: 'reset-busy', currentGeneration: 'g2' });
    const sameId = handleControlCommand(
      { command: 'reset-begin', resetId: 'r1', expectedGeneration: 'g1' },
      runtime,
    );
    const status = handleControlCommand({ command: 'generation-status' }, runtime);
    let statusSettled = false;
    void status.then(() => {
      statusSettled = true;
    });
    await Promise.resolve();
    expect(statusSettled).toBe(false);
    replacement.resolve('g2');
    await expect(reset).resolves.toMatchObject({ code: 'completed', resultingGeneration: 'g2' });
    await expect(sameId).resolves.toMatchObject({ code: 'completed', resultingGeneration: 'g2' });
    await expect(status).resolves.toEqual({
      ok: true,
      kind: 'generation-status',
      code: 'current',
      currentGeneration: 'g2',
    });
  });

  it('distinguishes Reset transaction identity while preserving same-ID waiter semantics', async () => {
    let generation = 'g1';
    const replacement = deferred<string>();
    const runtime = createFailureControlRuntime({
      owner: new FailureControlOwner(),
      ledger: new ResetTransactionLedger(),
      getGeneration: () => generation,
      replaceAndSeed: async () => {
        generation = 'g2';
        return replacement.promise;
      },
    });
    const reset = handleControlCommand(
      { command: 'reset-begin', resetId: 'active', expectedGeneration: 'g1' },
      runtime,
    );
    await Promise.resolve();

    await expect(
      Promise.race([
        handleControlCommand(
          { command: 'reset-status', resetId: 'other', expectedGeneration: 'g1' },
          runtime,
        ),
        new Promise((resolve) => setTimeout(() => resolve('still-waiting'), 0)),
      ]),
    ).resolves.toEqual({
      ok: false,
      kind: 'reset-status',
      code: 'reset-mismatch',
      resetId: 'other',
      currentGeneration: 'g2',
    });
    await expect(
      handleControlCommand(
        { command: 'reset-begin', resetId: 'other', expectedGeneration: 'g1' },
        runtime,
      ),
    ).resolves.toEqual({
      ok: false,
      kind: 'reset',
      code: 'reset-busy',
      resetId: 'other',
      currentGeneration: 'g2',
    });
    await expect(
      Promise.race([
        handleControlCommand(
          { command: 'reset-begin', resetId: 'active', expectedGeneration: 'different' },
          runtime,
        ),
        new Promise((resolve) => setTimeout(() => resolve('still-waiting'), 0)),
      ]),
    ).resolves.toEqual({
      ok: false,
      kind: 'reset',
      code: 'identity-mismatch',
      resetId: 'active',
      currentGeneration: 'g2',
    });

    const sameId = handleControlCommand(
      { command: 'reset-status', resetId: 'active', expectedGeneration: 'g1' },
      runtime,
    );
    await expect(
      Promise.race([
        sameId,
        new Promise((resolve) => setTimeout(() => resolve('still-waiting'), 0)),
      ]),
    ).resolves.toBe('still-waiting');
    replacement.resolve('g2');
    await expect(reset).resolves.toMatchObject({ code: 'completed' });
    await expect(sameId).resolves.toMatchObject({ code: 'completed', kind: 'reset-status' });

    for (const command of ['reset-begin', 'reset-status'] as const)
      await expect(
        handleControlCommand(
          { command, resetId: 'active', expectedGeneration: 'different' },
          runtime,
        ),
      ).resolves.toEqual({
        ok: false,
        kind: command === 'reset-begin' ? 'reset' : 'reset-status',
        code: 'identity-mismatch',
        resetId: 'active',
        currentGeneration: 'g2',
      });
  });

  it.each(['reject', 'lose-response', 'checkpoint-failure'] as const)(
    'makes late %s reservation finish stale after Reset invalidation',
    async (mode) => {
      const value = harness();
      const controlId = `reserved-${mode}`;
      await value.command({
        command: 'failure-arm',
        controlId,
        mode,
        ...(mode === 'checkpoint-failure'
          ? { targetEpisodeId: 'target' }
          : { targetOperationId: 'target' }),
        expectedGeneration: 'g1',
      });
      const reservation =
        mode === 'checkpoint-failure'
          ? value.owner.reserveCheckpoint('target')
          : value.owner.reserveProposal('target');
      expect(reservation).toMatchObject({ code: 'reserved' });
      await value.command({
        command: 'reset-begin',
        resetId: `reset-${mode}`,
        expectedGeneration: 'g1',
      });
      expect(value.owner.finish(reservation.state.reservationId, 'restored')).toEqual({
        code: 'stale-reset',
      });
      expect(value.owner.status(controlId)).toMatchObject({ code: 'invalidated-reset' });
    },
  );

  it('drops a completed Reset acknowledgement but replays the exact retained terminal result', async () => {
    const value = harness();
    await expect(
      value.command({
        command: 'reset-begin',
        resetId: 'lost-reset',
        expectedGeneration: 'g1',
        dropAcknowledgement: true,
      }),
    ).rejects.toBeInstanceOf(DropControlAcknowledgement);
    expect(value.replacements()).toBe(1);
    await expect(
      value.command({
        command: 'reset-status',
        resetId: 'lost-reset',
        expectedGeneration: 'g1',
      }),
    ).resolves.toEqual({
      ok: true,
      kind: 'reset-status',
      code: 'completed',
      resetId: 'lost-reset',
      expectedGeneration: 'g1',
      resultingGeneration: 'g2',
    });
    await expect(
      value.command({
        command: 'reset-begin',
        resetId: 'lost-reset',
        expectedGeneration: 'g1',
      }),
    ).resolves.toMatchObject({ code: 'completed', resultingGeneration: 'g2' });
    expect(value.replacements()).toBe(1);
  });

  it('queues one exact Reset behind generation replacement even after both callers stop waiting', async () => {
    let generation = 'g1';
    const seed = deferred<undefined>();
    let replacements = 0;
    const runtime = createFailureControlRuntime({
      owner: new FailureControlOwner(),
      ledger: new ResetTransactionLedger(),
      getGeneration: () => generation,
      replaceAndSeed: async () => {
        replacements++;
        generation = `g${replacements + 1}`;
        await seed.promise;
        return generation;
      },
    });

    const replacement = handleControlCommand(
      {
        command: 'generation-replace',
        replaceId: 'replacement-1',
        expectedGeneration: 'g1',
      },
      runtime,
    );
    await Promise.resolve();
    const reset = handleControlCommand(
      { command: 'reset-begin', resetId: 'reset-1', expectedGeneration: 'g1' },
      runtime,
    );
    const duplicate = handleControlCommand(
      { command: 'reset-begin', resetId: 'reset-1', expectedGeneration: 'g1' },
      runtime,
    );

    await expect(
      handleControlCommand(
        { command: 'reset-begin', resetId: 'different-reset', expectedGeneration: 'g1' },
        runtime,
      ),
    ).resolves.toMatchObject({ code: 'reset-busy' });
    expect(runtime.diagnostics()).toMatchObject({
      activeMutation: 'generation-replace',
      queuedReset: true,
    });

    // Simulate both HTTP clients abandoning their promises. The server-owned work remains live.
    void replacement;
    void reset;
    seed.resolve(undefined);

    await expect(replacement).resolves.toEqual({
      ok: true,
      kind: 'generation-replace',
      code: 'completed',
      replaceId: 'replacement-1',
      expectedGeneration: 'g1',
      resultingGeneration: 'g2',
    });
    await expect(reset).resolves.toMatchObject({
      ok: false,
      kind: 'reset',
      code: 'stale-generation',
      resetId: 'reset-1',
      currentGeneration: 'g2',
    });
    await expect(duplicate).resolves.toMatchObject({ code: 'stale-generation' });
    await expect(
      handleControlCommand(
        { command: 'reset-status', resetId: 'reset-1', expectedGeneration: 'g1' },
        runtime,
      ),
    ).resolves.toMatchObject({
      kind: 'reset-status',
      code: 'stale-generation',
      resetId: 'reset-1',
      currentGeneration: 'g2',
    });
    expect(replacements).toBe(1);
    expect(runtime.diagnostics()).toMatchObject({ activeMutation: null, queuedReset: false });
  });

  it('makes generation replacement identity replay-safe and keeps its ledger bounded', async () => {
    const value = harness();
    const first = await value.command({
      command: 'generation-replace',
      replaceId: 'replace-1',
      expectedGeneration: 'g1',
    });
    expect(first).toEqual({
      ok: true,
      kind: 'generation-replace',
      code: 'completed',
      replaceId: 'replace-1',
      expectedGeneration: 'g1',
      resultingGeneration: 'g2',
    });
    await expect(
      value.command({
        command: 'generation-replace',
        replaceId: 'replace-1',
        expectedGeneration: 'g1',
      }),
    ).resolves.toEqual(first);
    await expect(
      value.command({
        command: 'generation-replace',
        replaceId: 'replace-1',
        expectedGeneration: 'g2',
      }),
    ).resolves.toMatchObject({ code: 'identity-mismatch', currentGeneration: 'g2' });
    expect(value.replacements()).toBe(1);

    for (let index = 2; index <= 18; index++)
      await value.command({
        command: 'generation-replace',
        replaceId: `replace-${index}`,
        expectedGeneration: `g${index}`,
      });
    expect(value.runtime.diagnostics()).toMatchObject({ replacementResults: 16 });
    await expect(
      value.command({
        command: 'generation-replace',
        replaceId: 'replace-1',
        expectedGeneration: 'g1',
      }),
    ).resolves.toMatchObject({ code: 'stale-generation', currentGeneration: 'g19' });
    expect(value.replacements()).toBe(18);
  });

  it('runs the sole queued Reset after a pre-mutation replacement failure', async () => {
    let generation = 'g1';
    let calls = 0;
    const runtime = createFailureControlRuntime({
      owner: new FailureControlOwner(),
      ledger: new ResetTransactionLedger(),
      getGeneration: () => generation,
      replaceAndSeed: async () => {
        calls++;
        if (calls === 1) throw new Error('replacement failed before mutation');
        generation = 'g2';
        return generation;
      },
    });
    const replacement = handleControlCommand(
      { command: 'generation-replace', replaceId: 'replace', expectedGeneration: 'g1' },
      runtime,
    );
    const reset = handleControlCommand(
      { command: 'reset-begin', resetId: 'reset', expectedGeneration: 'g1' },
      runtime,
    );
    const status = handleControlCommand(
      { command: 'reset-status', resetId: 'reset', expectedGeneration: 'g1' },
      runtime,
    );
    await expect(
      handleControlCommand(
        { command: 'reset-status', resetId: 'other', expectedGeneration: 'g1' },
        runtime,
      ),
    ).resolves.toMatchObject({ code: 'reset-mismatch' });

    await expect(replacement).resolves.toMatchObject({
      code: 'partial-failure',
      currentGeneration: 'g1',
    });
    await expect(reset).resolves.toMatchObject({ code: 'completed', resultingGeneration: 'g2' });
    await expect(status).resolves.toMatchObject({
      kind: 'reset-status',
      code: 'completed',
      resultingGeneration: 'g2',
    });
    expect(calls).toBe(2);
    expect(runtime.diagnostics()).toMatchObject({ activeMutation: null, queuedReset: false });
  });
});
