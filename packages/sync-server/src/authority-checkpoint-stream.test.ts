import { describe, expect, it, vi } from 'vitest';
import { AuthorityCheckpointAssembler, parseAuthorityServerFrame } from '@fieldnotes/sync';
import {
  sendPreparedAuthorityCheckpoint,
  streamAuthorityCheckpoint,
} from './authority-checkpoint-stream';
import { projectAuthorityChange } from './authority-projection';
import type { AuthorityReadContext, AuthorityRoomDefinition } from './authority-types';

const cursor = { generation: 'g', streamId: '0123456789abcdef0123456789abcdef', revision: 0 };

describe('authority checkpoint stream', () => {
  it('blocks an end frame when encoding itself reaches the stream deadline', async () => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const prepared = await (
      await import('@fieldnotes/sync')
    ).prepareAuthorityCheckpoint(
      { cursor, elements: [], layers: [], extensions: {} },
      { requestId: 'request', checkpointId: 'checkpoint', requiredExtensions: [] },
    );
    const stringify = JSON.stringify;
    const encoded = vi.spyOn(JSON, 'stringify').mockImplementation((value) => {
      if (
        typeof value === 'object' &&
        value !== null &&
        'kind' in value &&
        value.kind === 'checkpoint-end'
      )
        now += 10_000;
      return stringify(value);
    });
    const offered: string[] = [];
    try {
      await expect(
        sendPreparedAuthorityCheckpoint(prepared, (_frame, kind) => {
          offered.push(kind);
          return { completion: Promise.resolve(), settled: Promise.resolve() };
        }),
      ).rejects.toThrow('timed out');
      expect(offered).toEqual(['checkpoint-begin', 'checkpoint-chunk']);
    } finally {
      encoded.mockRestore();
      clock.mockRestore();
    }
  });

  it('keeps the next frame blocked while non-end settlement is pending across expiry', async () => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const prepared = await (
      await import('@fieldnotes/sync')
    ).prepareAuthorityCheckpoint(
      { cursor, elements: [], layers: [], extensions: {} },
      { requestId: 'request', checkpointId: 'checkpoint', requiredExtensions: [] },
    );
    let settle: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const offered: string[] = [];
    try {
      const running = sendPreparedAuthorityCheckpoint(prepared, (_frame, kind) => {
        offered.push(kind);
        return {
          completion: Promise.resolve(),
          settled: kind === 'checkpoint-begin' ? pending : Promise.resolve(),
        };
      });
      await vi.waitFor(() => expect(offered).toEqual(['checkpoint-begin']));
      now += 10_000;
      await Promise.resolve();
      expect(offered).toEqual(['checkpoint-begin']);
      settle?.();
      await expect(running).rejects.toThrow('timed out');
      expect(offered).toEqual(['checkpoint-begin']);
    } finally {
      settle?.();
      clock.mockRestore();
    }
  });

  it.each(['completion', 'settlement'] as const)(
    'rejects a checkpoint whose %s crosses the fixed stream deadline without a timer callback',
    async (boundary) => {
      let now = 1_000_000;
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
      const prepared = await (
        await import('@fieldnotes/sync')
      ).prepareAuthorityCheckpoint(
        { cursor, elements: [], layers: [], extensions: {} },
        { requestId: 'request', checkpointId: 'checkpoint', requiredExtensions: [] },
      );
      const admitted: { kind: string; deadline: number }[] = [];
      try {
        await expect(
          sendPreparedAuthorityCheckpoint(prepared, (_frame, kind, deadline) => {
            admitted.push({ kind, deadline });
            if (kind === 'checkpoint-end' && boundary === 'completion')
              return {
                completion: Promise.resolve().then(() => {
                  now += 10_000;
                }),
                settled: Promise.resolve(),
              };
            if (kind === 'checkpoint-begin' && boundary === 'settlement')
              return {
                completion: Promise.resolve(),
                settled: Promise.resolve().then(() => {
                  now += 10_000;
                }),
              };
            return { completion: Promise.resolve(), settled: Promise.resolve() };
          }),
        ).rejects.toThrow('timed out');
        expect(admitted[0]?.deadline).toBe(1_010_000);
        expect(admitted.at(-1)?.deadline).toBe(1_010_000);
      } finally {
        clock.mockRestore();
      }
    },
  );
  it('passes the same absolute admitted stream deadline to the pre-end read', async () => {
    const source = { cursor, elements: [], layers: [], extensions: {} };
    const prepared = await (
      await import('@fieldnotes/sync')
    ).prepareAuthorityCheckpoint(source, {
      requestId: 'request',
      checkpointId: 'checkpoint',
      requiredExtensions: [],
    });
    const seen: (number | undefined)[] = [];
    let admittedAt = 0;
    await sendPreparedAuthorityCheckpoint(
      prepared,
      (_frame, kind) => {
        if (kind === 'checkpoint-begin') admittedAt = Date.now();
        return { completion: Promise.resolve(), settled: Promise.resolve() };
      },
      undefined,
      undefined,
      async (_kind, deadline) => {
        seen.push(deadline);
      },
    );
    expect(seen[0]).toBeUndefined();
    expect(admittedAt).toBeGreaterThan(0);
    expect(seen[1]).toBe(admittedAt + 10_000);
  });
  it('paces a near-limit complete cut through physical sends without accumulating chunks', async () => {
    const source = {
      cursor,
      elements: [
        {
          id: 'large',
          type: 'note' as const,
          position: { x: 0, y: 0 },
          zIndex: 0,
          locked: false,
          layerId: 'default',
          size: { w: 1, h: 1 },
          text: 'x'.repeat(20_900_000),
          backgroundColor: 'white',
          textColor: 'black',
        },
      ],
      layers: [],
      extensions: {},
    };
    const realNow = performance.now.bind(performance);
    const started = realNow();
    const offered: { frame: string; complete: () => void }[] = [];
    let maxOutstanding = 0;
    let maxFrameBytes = 0;
    let consumed = 0;
    const assembler = new AuthorityCheckpointAssembler({
      requestId: 'request',
      generation: 'g',
      requiredExtensions: [],
    });
    const abort = new AbortController();
    let signalOffer: (() => void) | undefined;
    const waitForOffer = () =>
      new Promise<void>((resolve) => {
        signalOffer = resolve;
      });
    let nextOffer = waitForOffer();
    let runningSettled: Promise<void> = Promise.resolve();
    try {
      vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
      vi.setSystemTime(1_000_000);
      const running = streamAuthorityCheckpoint(
        source,
        {
          requestId: 'request',
          checkpointId: 'checkpoint',
          requiredExtensions: [],
          signal: abort.signal,
        },
        (frame) => {
          expect(offered.length - consumed).toBe(0);
          maxFrameBytes = Math.max(maxFrameBytes, Buffer.byteLength(frame, 'utf8'));
          let complete: (() => void) | undefined;
          const completion = new Promise<void>((resolve) => {
            complete = resolve;
          });
          offered.push({ frame, complete: () => complete?.() });
          maxOutstanding = Math.max(maxOutstanding, offered.length - consumed);
          signalOffer?.();
          signalOffer = undefined;
          return { completion, settled: completion };
        },
      );
      runningSettled = running.then(
        () => undefined,
        () => undefined,
      );
      const awaitNextOffer = () =>
        Promise.race([
          nextOffer,
          running.then(
            () => {
              throw new Error('checkpoint stream ended before the next frame');
            },
            (error: unknown) => {
              throw error;
            },
          ),
        ]);
      await awaitNextOffer();
      expect(offered).toHaveLength(1);
      expect(parseAuthorityServerFrame(offered[0]?.frame ?? '')?.kind).toBe('checkpoint-begin');
      // A physical send remains unsettled across an explicit clock step.
      const beforeDate = Date.now();
      const beforePerformance = performance.now();
      await vi.advanceTimersByTimeAsync(1);
      expect(Date.now()).toBe(beforeDate + 1);
      expect(performance.now()).toBe(beforePerformance + 1);
      expect(offered).toHaveLength(1);
      while (true) {
        const item = offered[consumed];
        if (!item) throw new Error('missing offered checkpoint frame');
        const kind = parseAuthorityServerFrame(item.frame)?.kind;
        if (kind !== 'checkpoint-end') nextOffer = waitForOffer();
        await assembler.accept(item.frame);
        item.complete();
        consumed++;
        vi.advanceTimersByTime(1);
        for (let index = 0; index < 20; index++) await Promise.resolve();
        expect(offered.length).toBeLessThanOrEqual(consumed + 1);
        if (kind === 'checkpoint-end') break;
        await awaitNextOffer();
      }
      const result = await running;
      expect(result.manifest.byteLength).toBeGreaterThan(18_000_000);
      expect(result.manifest.byteLength).toBeLessThanOrEqual(20_971_520);
      expect(consumed).toBe(result.manifest.chunkCount + 2);
      expect(maxOutstanding).toBe(1);
      expect(maxFrameBytes).toBeLessThanOrEqual(1_048_576);
      expect(20_971_520 + 4 * 524_288 + 2 * 699_052 + 32 * 1024 + 256 * 1024).toBe(24_761_688);
      expect(24_761_688).toBeLessThan(24 * 1024 * 1024);
      expect(assembler.status).toBe('complete');
      console.info(
        `near-limit checkpoint: ${result.manifest.byteLength} bytes, ${result.manifest.chunkCount} chunks, ${Math.round(realNow() - started)} ms local observational duration, peak ${maxOutstanding} offered frame, max wire ${maxFrameBytes} bytes`,
      );
      const definition: AuthorityRoomDefinition = {
        id: 'definition',
        extensions: [],
        project: (_context, state) => state,
        canReadOwnerId: () => false,
      };
      const context: AuthorityReadContext = {
        room: 'table',
        connectionId: 'reader',
        actorId: 'reader',
        ownershipId: 'reader',
        definitionId: 'definition',
        deadlineAt: Date.now() + 5000,
        signal: new AbortController().signal,
      };
      const large = source.elements[0];
      if (!large) throw new Error('missing large element');
      const before = { elements: [large], layers: [], extensions: {} };
      const moved = {
        elements: [{ ...large, position: { x: 1, y: 0 } }],
        layers: [],
        extensions: {},
      };
      const nearStarted = realNow();
      const largeChange = projectAuthorityChange(definition, context, before, moved, {
        ...cursor,
        revision: 1,
      });
      const nearMs = Math.round(realNow() - nearStarted);
      const small = { elements: [{ ...large, text: 'small' }], layers: [], extensions: {} };
      const smallMoved = {
        elements: [{ ...large, text: 'small', position: { x: 1, y: 0 } }],
        layers: [],
        extensions: {},
      };
      const smallStarted = realNow();
      const smallChange = projectAuthorityChange(definition, context, small, smallMoved, {
        ...cursor,
        revision: 1,
      });
      const smallMs = Math.round(realNow() - smallStarted);
      expect(largeChange.status).toBe('checkpoint');
      expect(smallChange.status).toBe('changes');
      console.info(
        `movement projection: small ${smallMs} ms, near-limit ${nearMs} ms local observational duration`,
      );
    } finally {
      abort.abort();
      for (const item of offered) item.complete();
      signalOffer?.();
      let pendingTimers: number;
      try {
        await runningSettled;
        assembler.dispose();
        pendingTimers = vi.getTimerCount();
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
      expect(pendingTimers).toBe(0);
    }
  }, 30_000);
});
