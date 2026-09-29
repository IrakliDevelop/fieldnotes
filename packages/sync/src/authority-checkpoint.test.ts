import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuthorityCheckpointAssembler,
  prepareAuthorityCheckpoint,
  serializeAuthorityFrame,
  MAX_AUTHORITY_CHUNK_BYTES,
  MAX_AUTHORITY_FRAME_BYTES,
  MAX_AUTHORITY_CHECKPOINT_BYTES,
} from './index';
import type {
  AuthorityCheckpointFrame,
  AuthorityCheckpointPayload,
  AuthorityCheckpointRequirement,
} from './index';

const empty: AuthorityCheckpointPayload = {
  cursor: { generation: 'g', streamId: 's', revision: 3 },
  elements: [],
  layers: [],
  extensions: {},
};
const prepare = (
  payload: AuthorityCheckpointPayload = empty,
  requiredExtensions: readonly AuthorityCheckpointRequirement[] = [],
) => prepareAuthorityCheckpoint(payload, { requestId: 'r', checkpointId: 'c', requiredExtensions });
const assembler = (requiredExtensions: readonly AuthorityCheckpointRequirement[] = []) =>
  new AuthorityCheckpointAssembler({ requestId: 'r', generation: 'g', requiredExtensions });
const wire = (frame: AuthorityCheckpointFrame): string => serializeAuthorityFrame(frame);
function frameAt<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error('fixture');
  return item;
}
async function deliver(frames: readonly AuthorityCheckpointFrame[], receiver = assembler()) {
  let result;
  for (const frame of frames) result = await receiver.accept(wire(frame));
  return result;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const requirement = (
  key: string,
  pluginName = 'fog',
  version = 1,
): AuthorityCheckpointRequirement => ({
  key,
  pluginName,
  version,
  validate: (data) => typeof data === 'object' && data !== null,
});

function rejectingValidator(deferred: boolean): {
  readonly requirement: AuthorityCheckpointRequirement;
  observed(): number;
  rejectLater(): void;
} {
  let calls = 0;
  let reject: ((reason: unknown) => void) | undefined;
  const thenable = {
    then(_resolve: (value: unknown) => void, rejectResult: (reason: unknown) => void) {
      calls += 1;
      if (deferred) reject = rejectResult;
      else rejectResult(new Error('private validator detail'));
    },
  };
  return {
    requirement: {
      key: 'fog',
      pluginName: 'fog',
      version: 1,
      validate: () => thenable as unknown as boolean,
    },
    observed: () => calls,
    rejectLater: () => reject?.(new Error('private validator detail')),
  };
}
const nextTurn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('authority checkpoint', () => {
  it('prepares and assembles a complete bounded checkpoint; truncation fails without partial state', async () => {
    const frames = [...(await prepare()).frames];
    expect(await deliver(frames)).toEqual({ status: 'complete', checkpoint: empty });
    const receiver = assembler();
    expect(await receiver.accept(wire(frameAt(frames, 0)))).toEqual({ status: 'pending' });
    expect(await receiver.accept(wire(frameAt(frames, frames.length - 1)))).toEqual({
      status: 'failed',
      reason: 'invalid',
    });
    expect(receiver.status).toBe('failed');
  });

  it('captures source before digest and freezes the complete result without freezing caller data', async () => {
    const gate = deferred<ArrayBuffer>();
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { subtle: { digest: () => gate.promise } });
    const source: {
      cursor: { generation: string; streamId: string; revision: number };
      elements: never[];
      layers: { id: string; version: number; editor: string }[];
      extensions: Record<string, never>;
    } = {
      cursor: { generation: 'g', streamId: 's', revision: 3 },
      elements: [],
      layers: [],
      extensions: {},
    };
    const options = {
      requestId: 'r',
      checkpointId: 'c',
      requiredExtensions: [] as AuthorityCheckpointRequirement[],
    };
    const pendingPrepare = prepareAuthorityCheckpoint(source, options);
    source.cursor.revision = 99;
    source.layers.push({ id: 'late', version: 1, editor: 'x' });
    options.requestId = 'later';
    options.checkpointId = 'later';
    vi.stubGlobal('crypto', real);
    const hash = await real.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(
        '{"cursor":{"generation":"g","revision":3,"streamId":"s"},"elements":[],"extensions":{},"layers":[]}',
      ),
    );
    gate.resolve(hash);
    const frames = [...(await pendingPrepare).frames];
    expect(
      (frames[0] as Extract<AuthorityCheckpointFrame, { kind: 'checkpoint-begin' }>).manifest.cursor
        .revision,
    ).toBe(3);
    expect(
      (frames[0] as Extract<AuthorityCheckpointFrame, { kind: 'checkpoint-begin' }>).manifest
        .requestId,
    ).toBe('r');
    expect(await deliver(frames)).toEqual({ status: 'complete', checkpoint: empty });
    expect(Object.isFrozen(source)).toBe(false);
  });

  it('requires the exact trusted extension set and preserves dangerous-looking own keys', async () => {
    const extensions: Record<string, { pluginName: string; version: number; data: unknown }> = {};
    Object.defineProperty(extensions, '__proto__', {
      enumerable: true,
      value: { pluginName: 'fog', version: 1, data: { tiles: [] } },
    });
    Object.defineProperty(extensions, 'constructor', {
      enumerable: true,
      value: { pluginName: 'fog', version: 1, data: { tiles: [1] } },
    });
    const required = [requirement('__proto__'), requirement('constructor')];
    const payload = { ...empty, extensions };
    const frames = [...(await prepare(payload, required)).frames];
    expect(await deliver(frames, assembler(required))).toEqual({
      status: 'complete',
      checkpoint: payload,
    });
    expect(await deliver(frames, assembler())).toEqual({ status: 'failed', reason: 'invalid' });
    await expect(prepare(empty, [requirement('fog')])).rejects.toThrow(TypeError);
    expect(() => assembler([requirement('fog'), requirement('fog')])).toThrow(TypeError);
    await expect(
      prepare(payload, [{ ...frameAt(required, 0), validate: () => false }, frameAt(required, 1)]),
    ).rejects.toThrow(TypeError);
    await expect(
      prepare(payload, [
        { ...frameAt(required, 0), validate: () => Promise.resolve(true) as unknown as boolean },
        frameAt(required, 1),
      ]),
    ).rejects.toThrow(TypeError);
  });

  it('copies trusted requirements and exposes only frozen complete extension data to validators', async () => {
    const data = { nested: [{ count: 1 }] };
    const payload = { ...empty, extensions: { fog: { pluginName: 'fog', version: 1, data } } };
    let calls = 0;
    const requirements: AuthorityCheckpointRequirement[] = [
      {
        key: 'fog',
        pluginName: 'fog',
        version: 1,
        validate(value) {
          calls += 1;
          expect(Object.isFrozen(value)).toBe(true);
          expect(Object.isFrozen((value as typeof data).nested)).toBe(true);
          expect(Object.isFrozen((value as typeof data).nested[0])).toBe(true);
          return true;
        },
      },
    ];
    const prepared = await prepare(payload, requirements);
    const receiver = assembler(requirements);
    requirements[0] = { key: 'wrong', pluginName: 'wrong', version: 9, validate: () => false };
    const result = await deliver([...prepared.frames], receiver);
    expect(result).toMatchObject({ status: 'complete' });
    expect(calls).toBe(2);
    if (result?.status !== 'complete') throw new Error('fixture');
    expect(Object.isFrozen(result.checkpoint)).toBe(true);
    expect(Object.isFrozen(result.checkpoint.extensions)).toBe(true);
    expect(Object.isFrozen(result.checkpoint.extensions.fog?.data)).toBe(true);
    expect(Object.isFrozen(data)).toBe(false);
    expect(
      await receiver.accept(
        '{"protocol":"authority:1","kind":"checkpoint-end","checkpointId":"c"}',
      ),
    ).toEqual({ status: 'failed', reason: 'closed' });
    expect(receiver.status).toBe('complete');
  });

  it.each([false, true])(
    'observes %s rejected validator thenables during preparation',
    async (deferred) => {
      const policy = rejectingValidator(deferred);
      const payload = {
        ...empty,
        extensions: { fog: { pluginName: 'fog', version: 1, data: {} } },
      };
      await expect(prepare(payload, [policy.requirement])).rejects.toThrow(
        'Invalid authority checkpoint',
      );
      await nextTurn();
      expect(policy.observed()).toBe(1);
      if (deferred) policy.rejectLater();
      await nextTurn();
    },
  );

  it.each([false, true])(
    'observes %s rejected validator thenables during assembly',
    async (deferred) => {
      const policy = rejectingValidator(deferred);
      const payload = {
        ...empty,
        extensions: { fog: { pluginName: 'fog', version: 1, data: {} } },
      };
      const frames = [...(await prepare(payload, [requirement('fog')])).frames];
      const receiver = assembler([policy.requirement]);
      expect(await deliver(frames, receiver)).toEqual({ status: 'failed', reason: 'invalid' });
      await nextTurn();
      expect(policy.observed()).toBe(1);
      if (deferred) policy.rejectLater();
      await nextTurn();
      expect(receiver.status).toBe('failed');
      expect(await receiver.accept(wire(frameAt(frames, 2)))).toEqual({
        status: 'failed',
        reason: 'invalid',
      });
    },
  );

  it.each([false, true])(
    'contains %s native Promise validator rejections on both APIs',
    async (isDeferred) => {
      const payload = {
        ...empty,
        extensions: { fog: { pluginName: 'fog', version: 1, data: {} } },
      };
      const prepareGate = deferred<boolean>();
      const prepareRequirement = {
        ...requirement('fog'),
        validate: () =>
          (isDeferred
            ? prepareGate.promise
            : Promise.reject(new Error('private prepare detail'))) as unknown as boolean,
      };
      await expect(prepare(payload, [prepareRequirement])).rejects.toThrow(
        'Invalid authority checkpoint',
      );
      if (isDeferred) prepareGate.reject(new Error('late private prepare detail'));
      await nextTurn();

      const frames = [...(await prepare(payload, [requirement('fog')])).frames];
      const assemblyGate = deferred<boolean>();
      const assemblyRequirement = {
        ...requirement('fog'),
        validate: () =>
          (isDeferred
            ? assemblyGate.promise
            : Promise.reject(new Error('private assembly detail'))) as unknown as boolean,
      };
      const receiver = assembler([assemblyRequirement]);
      expect(await deliver(frames, receiver)).toEqual({ status: 'failed', reason: 'invalid' });
      if (isDeferred) assemblyGate.reject(new Error('late private assembly detail'));
      await nextTurn();
      expect(receiver.status).toBe('failed');
    },
  );

  it.each(['getter', 'call'])(
    'contains throwing thenable %s behind generic failures on both APIs',
    async (mode) => {
      const payload = {
        ...empty,
        extensions: { fog: { pluginName: 'fog', version: 1, data: {} } },
      };
      const thenable =
        mode === 'getter'
          ? Object.defineProperty({}, 'then', {
              get() {
                throw new Error('private getter detail');
              },
            })
          : {
              then() {
                throw new Error('private assimilation detail');
              },
            };
      const invalidRequirement = {
        ...requirement('fog'),
        validate: () => thenable as unknown as boolean,
      };
      await expect(prepare(payload, [invalidRequirement])).rejects.toThrow(
        'Invalid authority checkpoint',
      );
      const frames = [...(await prepare(payload, [requirement('fog')])).frames];
      const receiver = assembler([invalidRequirement]);
      expect(await deliver(frames, receiver)).toEqual({ status: 'failed', reason: 'invalid' });
      await nextTurn();
      expect(receiver.status).toBe('failed');
    },
  );

  it('accepts layer tombstones and rejects duplicate element or layer IDs', async () => {
    const tombstone = { id: 'missing', version: 1, editor: 'dm' };
    const shape = {
      id: 'a',
      type: 'shape' as const,
      position: { x: 0, y: 0 },
      zIndex: 0,
      locked: false,
      layerId: 'missing',
      shape: 'rectangle' as const,
      size: { w: 1, h: 1 },
      strokeColor: 'red',
      strokeWidth: 1,
      fillColor: 'blue',
    };
    const value = { ...empty, elements: [shape], layers: [tombstone] };
    expect(await deliver([...(await prepare(value)).frames])).toEqual({
      status: 'complete',
      checkpoint: value,
    });
    await expect(prepare({ ...value, elements: [shape, shape] })).rejects.toThrow(TypeError);
    await expect(prepare({ ...value, layers: [tombstone, tombstone] })).rejects.toThrow(TypeError);
  });

  it('uses exact contiguous chunks and each serialized frame remains within one MiB', async () => {
    const data = {
      ...empty,
      extensions: {
        large: {
          pluginName: 'fog',
          version: 1,
          data: { text: 'a'.repeat(MAX_AUTHORITY_CHUNK_BYTES) },
        },
      },
    };
    const required = [requirement('large')];
    const frames = [...(await prepare(data, required)).frames];
    expect(frames.map((frame) => frame.kind)).toEqual([
      'checkpoint-begin',
      'checkpoint-chunk',
      'checkpoint-chunk',
      'checkpoint-end',
    ]);
    for (const frame of frames)
      expect(new TextEncoder().encode(wire(frame)).length).toBeLessThanOrEqual(
        MAX_AUTHORITY_FRAME_BYTES,
      );
    expect(await deliver(frames, assembler(required))).toEqual({
      status: 'complete',
      checkpoint: data,
    });
    expect(
      await deliver(
        [frameAt(frames, 0), frameAt(frames, 2), frameAt(frames, 1), frameAt(frames, 3)],
        assembler(required),
      ),
    ).toEqual({ status: 'failed', reason: 'invalid' });
  });

  it('rejects malformed traffic, duplicate chunks, mismatched hash and noncanonical JSON', async () => {
    const frames = [...(await prepare()).frames];
    const begin = frameAt(frames, 0);
    const chunk = frameAt(frames, 1);
    const end = frameAt(frames, 2);
    expect(await deliver([begin, chunk, chunk, end])).toEqual({
      status: 'failed',
      reason: 'invalid',
    });
    expect(
      await deliver([begin, { ...chunk, checkpointId: 'foreign' } as AuthorityCheckpointFrame]),
    ).toEqual({ status: 'failed', reason: 'invalid' });
    expect(await deliver([begin, { ...chunk, data: 'AQ==' } as AuthorityCheckpointFrame])).toEqual({
      status: 'failed',
      reason: 'invalid',
    });
    const badPadding = assembler();
    await badPadding.accept(wire(begin));
    expect(await badPadding.accept(JSON.stringify({ ...chunk, data: 'Zh==' }))).toEqual({
      status: 'failed',
      reason: 'invalid',
    });
    const badManifest = {
      ...(begin as Extract<AuthorityCheckpointFrame, { kind: 'checkpoint-begin' }>).manifest,
      sha256: '0'.repeat(64),
    };
    expect(
      await deliver([
        { protocol: 'authority:1', kind: 'checkpoint-begin', manifest: badManifest },
        chunk,
        end,
      ]),
    ).toEqual({ status: 'failed', reason: 'invalid' });
    const decoded = atob(
      (chunk as Extract<AuthorityCheckpointFrame, { kind: 'checkpoint-chunk' }>).data,
    );
    const reordered = decoded.replace('"cursor":', '"zzz":0,"cursor":');
    expect(reordered).not.toBe(decoded);
    const changedBytes = new TextEncoder().encode(reordered);
    const digest = await crypto.subtle.digest('SHA-256', changedBytes);
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const alteredBegin = {
      protocol: 'authority:1' as const,
      kind: 'checkpoint-begin' as const,
      manifest: { ...badManifest, byteLength: changedBytes.length, sha256: hash },
    };
    const alteredChunk = {
      protocol: 'authority:1' as const,
      kind: 'checkpoint-chunk' as const,
      checkpointId: 'c',
      index: 0,
      data: btoa(reordered),
    };
    expect(await deliver([alteredBegin, alteredChunk, end])).toEqual({
      status: 'failed',
      reason: 'invalid',
    });
  });

  it('settles pending end promptly on dispose and ignores later digest resolution or rejection', async () => {
    const frames = [...(await prepare()).frames];
    const gate = deferred<ArrayBuffer>();
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { subtle: { digest: () => gate.promise } });
    const receiver = assembler();
    await receiver.accept(wire(frameAt(frames, 0)));
    await receiver.accept(wire(frameAt(frames, 1)));
    const finishing = receiver.accept(wire(frameAt(frames, 2)));
    expect(receiver.status).toBe('verifying');
    receiver.dispose();
    expect(await finishing).toEqual({ status: 'failed', reason: 'disposed' });
    expect(receiver.status).toBe('disposed');
    gate.reject(new Error('late crypto rejection'));
    await Promise.resolve();
    expect(receiver.status).toBe('disposed');
    vi.stubGlobal('crypto', real);
  });

  it('settles pending end on concurrent invalidation and timeout without waiting for digest', async () => {
    const frames = [...(await prepare()).frames];
    const gate = deferred<ArrayBuffer>();
    vi.stubGlobal('crypto', { subtle: { digest: () => gate.promise } });
    const receiver = assembler();
    await receiver.accept(wire(frameAt(frames, 0)));
    await receiver.accept(wire(frameAt(frames, 1)));
    const finishing = receiver.accept(wire(frameAt(frames, 2)));
    expect(await receiver.accept(wire(frameAt(frames, 2)))).toEqual({
      status: 'failed',
      reason: 'invalid',
    });
    expect(await finishing).toEqual({ status: 'failed', reason: 'invalid' });
    gate.resolve(new ArrayBuffer(32));
    await Promise.resolve();
    expect(receiver.status).toBe('failed');
  });

  it('uses a fixed ten-second deadline and settles an unresolved digest on timeout', async () => {
    const frames = [...(await prepare()).frames];
    vi.useFakeTimers();
    const gate = deferred<ArrayBuffer>();
    vi.stubGlobal('crypto', { subtle: { digest: () => gate.promise } });
    const receiver = assembler();
    await receiver.accept(wire(frameAt(frames, 0)));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(await receiver.accept(wire(frameAt(frames, 1)))).toEqual({ status: 'pending' });
    const finishing = receiver.accept(wire(frameAt(frames, 2)));
    await vi.advanceTimersByTimeAsync(1);
    expect(await finishing).toEqual({ status: 'failed', reason: 'timeout' });
    gate.resolve(new ArrayBuffer(32));
    await Promise.resolve();
    expect(receiver.status).toBe('failed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('checks the monotonic deadline even before a delayed timer callback runs', async () => {
    const frames = [...(await prepare()).frames];
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const receiver = assembler();
    expect(await receiver.accept(wire(frameAt(frames, 0)))).toEqual({ status: 'pending' });
    now = 10_000;
    expect(await receiver.accept(wire(frameAt(frames, 1)))).toEqual({
      status: 'failed',
      reason: 'timeout',
    });
  });

  it('fails a missing end at the original deadline despite chunk traffic', async () => {
    const frames = [...(await prepare()).frames];
    vi.useFakeTimers();
    const receiver = assembler();
    await receiver.accept(wire(frameAt(frames, 0)));
    await vi.advanceTimersByTimeAsync(9_000);
    expect(await receiver.accept(wire(frameAt(frames, 1)))).toEqual({ status: 'pending' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(receiver.status).toBe('failed');
    expect(await receiver.accept(wire(frameAt(frames, 2)))).toEqual({
      status: 'failed',
      reason: 'timeout',
    });
  });

  it('settles unresolved digest on abort and rejects later messages with the stored reason', async () => {
    const frames = [...(await prepare()).frames];
    const gate = deferred<ArrayBuffer>();
    const controller = new AbortController();
    const receiver = new AuthorityCheckpointAssembler({
      requestId: 'r',
      generation: 'g',
      requiredExtensions: [],
      signal: controller.signal,
    });
    vi.stubGlobal('crypto', { subtle: { digest: () => gate.promise } });
    await receiver.accept(wire(frameAt(frames, 0)));
    await receiver.accept(wire(frameAt(frames, 1)));
    const finishing = receiver.accept(wire(frameAt(frames, 2)));
    controller.abort();
    expect(await finishing).toEqual({ status: 'failed', reason: 'aborted' });
    expect(await receiver.accept(wire(frameAt(frames, 2)))).toEqual({
      status: 'failed',
      reason: 'aborted',
    });
    gate.reject(new Error('late rejection'));
    await Promise.resolve();
    expect(receiver.status).toBe('failed');
  });

  it('has independently known canonical bytes and hash', async () => {
    const prepared = await prepare();
    expect(prepared.manifest.sha256).toBe(
      '675169652ecf244400ffc56bd02bcc278b0eca19b73fd28269cf85cd151c0136',
    );
    const chunk = [...prepared.frames][1];
    if (chunk?.kind !== 'checkpoint-chunk') throw new Error('fixture');
    expect(atob(chunk.data)).toBe(
      '{"cursor":{"generation":"g","revision":3,"streamId":"s"},"elements":[],"extensions":{},"layers":[]}',
    );
  });

  it('sorts non-BMP keys by UTF-16, normalizes negative zero and escapes controls', async () => {
    const data = {
      ...empty,
      extensions: { fog: { pluginName: 'fog', version: 1, data: { '😀': -0, z: '\n\u0001' } } },
    };
    const prepared = await prepare(data, [requirement('fog')]);
    expect(prepared.manifest.sha256).toBe(
      '7a550c6a4376ae1e428c5fe29a268ce477c9eb9216954486d61f4322ce4d4a0a',
    );
    const chunk = [...prepared.frames][1];
    if (chunk?.kind !== 'checkpoint-chunk') throw new Error('fixture');
    const bytes = Uint8Array.from(atob(chunk.data), (char) => char.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe(
      '{"cursor":{"generation":"g","revision":3,"streamId":"s"},"elements":[],"extensions":{"fog":{"data":{"z":"\\n\\u0001","😀":0},"pluginName":"fog","version":1}},"layers":[]}',
    );
  });

  it('rejects payload/manifest mismatch even when its hash is valid', async () => {
    const frames = [...(await prepare()).frames];
    const begin = frames[0];
    const chunk = frames[1];
    const end = frames[2];
    if (begin?.kind !== 'checkpoint-begin' || chunk?.kind !== 'checkpoint-chunk' || !end)
      throw new Error('fixture');
    const alteredText = atob(chunk.data).replace('"revision":3', '"revision":4');
    const bytes = new TextEncoder().encode(alteredText);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const tampered = [
      { ...begin, manifest: { ...begin.manifest, sha256 } },
      { ...chunk, data: btoa(alteredText) },
      end,
    ];
    expect(await deliver(tampered)).toEqual({ status: 'failed', reason: 'invalid' });
  });

  it('rejects BOM, duplicate JSON keys, alternate spelling and overflow numbers after valid hashes', async () => {
    const frames = [...(await prepare()).frames];
    const begin = frames[0];
    const end = frames[2];
    if (begin?.kind !== 'checkpoint-begin' || !end) throw new Error('fixture');
    const canonical =
      '{"cursor":{"generation":"g","revision":3,"streamId":"s"},"elements":[],"extensions":{},"layers":[]}';
    const variants = [
      '\ufeff' + canonical,
      canonical.replace('"elements":[]', '"elements":[],"elements":[]'),
      canonical.replace('"revision":3', '"revision":3.0'),
      canonical.replace('"revision":3', '"revision":1e999'),
      canonical.replace('"generation":"g"', '"generation":"\\u0067"'),
    ];
    for (const text of variants) {
      const bytes = new TextEncoder().encode(text);
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = [...new Uint8Array(hash)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      const data = btoa([...bytes].map((byte) => String.fromCharCode(byte)).join(''));
      expect(
        await deliver([
          { ...begin, manifest: { ...begin.manifest, byteLength: bytes.length, sha256 } },
          { protocol: 'authority:1', kind: 'checkpoint-chunk', checkpointId: 'c', index: 0, data },
          end,
        ]),
      ).toEqual({ status: 'failed', reason: 'invalid' });
    }
  });

  it('rejects malformed UTF-8 after a valid digest', async () => {
    const frames = [...(await prepare()).frames];
    const begin = frameAt(frames, 0);
    const end = frameAt(frames, 2);
    if (begin.kind !== 'checkpoint-begin') throw new Error('fixture');
    const bytes = new Uint8Array([0xc3, 0x28]);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(hash)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    expect(
      await deliver([
        { ...begin, manifest: { ...begin.manifest, byteLength: 2, sha256 } },
        {
          protocol: 'authority:1',
          kind: 'checkpoint-chunk',
          checkpointId: 'c',
          index: 0,
          data: 'wyg=',
        },
        end,
      ]),
    ).toEqual({ status: 'failed', reason: 'invalid' });
  });

  it('permits the exact byte budget and rejects one byte over', async () => {
    const required = [requirement('large')];
    const makePayload = (length: number): AuthorityCheckpointPayload => ({
      ...empty,
      extensions: { large: { pluginName: 'fog', version: 1, data: { text: 'x'.repeat(length) } } },
    });
    const overhead = new TextEncoder().encode(
      '{"cursor":{"generation":"g","revision":3,"streamId":"s"},"elements":[],"extensions":{"large":{"data":{"text":""},"pluginName":"fog","version":1}},"layers":[]}',
    ).length;
    const prepared = await prepare(
      makePayload(MAX_AUTHORITY_CHECKPOINT_BYTES - overhead),
      required,
    );
    expect(prepared.manifest.byteLength).toBe(MAX_AUTHORITY_CHECKPOINT_BYTES);
    expect(prepared.manifest.chunkCount).toBe(40);
    const frames = [...prepared.frames];
    expect(frames.filter((frame) => frame.kind === 'checkpoint-chunk')).toHaveLength(40);
    expect(await deliver(frames, assembler(required))).toMatchObject({ status: 'complete' });
    await expect(
      prepare(makePayload(MAX_AUTHORITY_CHECKPOINT_BYTES - overhead + 1), required),
    ).rejects.toThrow(RangeError);
  });

  it('accepts depth 64 and rejects depth 65 in extension data', async () => {
    const nested = (count: number): unknown => {
      let value: unknown = 0;
      for (let index = 0; index < count; index += 1) value = [value];
      return value;
    };
    const make = (count: number): AuthorityCheckpointPayload => ({
      ...empty,
      extensions: { fog: { pluginName: 'fog', version: 1, data: nested(count) } },
    });
    const required = [{ ...requirement('fog'), validate: Array.isArray }];
    expect(await prepare(make(61), required)).toBeDefined();
    await expect(prepare(make(62), required)).rejects.toThrow(RangeError);
  });

  it('aborted preparation and iteration release state', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      prepareAuthorityCheckpoint(empty, {
        requestId: 'r',
        checkpointId: 'c',
        requiredExtensions: [],
        signal: controller.signal,
      }),
    ).rejects.toThrow('aborted');
    const later = new AbortController();
    const prepared = await prepareAuthorityCheckpoint(empty, {
      requestId: 'r',
      checkpointId: 'c',
      requiredExtensions: [],
      signal: later.signal,
    });
    expect(prepared.frames.next().done).toBe(false);
    later.abort();
    expect(prepared.frames.next().done).toBe(true);
    prepared.dispose();
    const returned = await prepare();
    expect(returned.frames.return?.().done).toBe(true);
    expect(returned.frames.next().done).toBe(true);
  });

  it('stops preparation when aborted during hashing and generates base64 only on pull', async () => {
    const controller = new AbortController();
    const gate = deferred<ArrayBuffer>();
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { subtle: { digest: () => gate.promise } });
    const preparing = prepareAuthorityCheckpoint(empty, {
      requestId: 'r',
      checkpointId: 'c',
      requiredExtensions: [],
      signal: controller.signal,
    });
    controller.abort();
    gate.resolve(new ArrayBuffer(32));
    await expect(preparing).rejects.toThrow('aborted');
    vi.stubGlobal('crypto', real);
    const prepared = await prepare();
    const base64 = vi.spyOn(globalThis, 'btoa');
    expect(base64).not.toHaveBeenCalled();
    expect(prepared.frames.next().value?.kind).toBe('checkpoint-begin');
    expect(base64).not.toHaveBeenCalled();
    expect(prepared.frames.next().value?.kind).toBe('checkpoint-chunk');
    expect(base64).toHaveBeenCalledTimes(1);
    prepared.dispose();
    expect(prepared.frames.next().done).toBe(true);
  });

  it('fails closed when WebCrypto is absent or rejects', async () => {
    vi.stubGlobal('crypto', undefined);
    await expect(prepare()).rejects.toThrow('crypto failure');
    vi.unstubAllGlobals();
    const frames = [...(await prepare()).frames];
    vi.stubGlobal('crypto', {
      subtle: { digest: () => Promise.reject(new Error('native details')) },
    });
    const receiver = assembler();
    expect(await deliver(frames, receiver)).toEqual({ status: 'failed', reason: 'crypto' });
    expect(receiver.status).toBe('failed');
  });
});
