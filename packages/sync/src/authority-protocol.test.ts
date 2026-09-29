import { describe, expect, it, vi } from 'vitest';
import {
  parseAuthorityFrame,
  parseAuthorityClientFrame,
  parseAuthorityServerFrame,
  serializeAuthorityFrame,
  MAX_AUTHORITY_FRAME_BYTES,
  MAX_AUTHORITY_CHUNK_BYTES,
  MAX_AUTHORITY_CHECKPOINT_BYTES,
} from './authority-protocol';
import type { AuthorityFrame, AuthorityMutation, AuthorityCursor } from './authority-protocol';
import { classifyAuthorityCursor } from './authority-cursor';
import { parseEnvelope } from './protocol';
import { parseBoundedJson, serializeBoundedJson } from './authority-json';

const cursor: AuthorityCursor = { generation: 'g', streamId: 's', revision: 7 };
const digest = 'a'.repeat(64);
const manifest = {
  requestId: 'q',
  checkpointId: 'c',
  cursor,
  encoding: 'base64' as const,
  compression: 'none' as const,
  byteLength: 1,
  chunkBytes: MAX_AUTHORITY_CHUNK_BYTES as 524288,
  chunkCount: 1,
  sha256: digest,
  extensions: [{ key: 'a', pluginName: 'fog', version: 1 }],
};
const mutations: AuthorityMutation[] = [
  { kind: 'remove', id: 'e' },
  { kind: 'clear' },
  {
    kind: 'layer-upsert',
    layer: { id: 'l', name: 'L', visible: true, locked: false, order: 1, opacity: 1 },
    version: 1,
    editor: 'a',
  },
  { kind: 'layer-remove', id: 'l', version: 1, editor: 'a' },
  { kind: 'fog-meta', record: { version: 1, editor: 'a' } },
  { kind: 'fog-patch', generation: 'g', tiles: [] },
  { kind: 'extension', extensionKind: 'fog', payload: { nested: [1, true, null] } },
  {
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
    },
  },
];

const client: AuthorityFrame[] = [
  ...mutations.map((mutation) => ({
    protocol: 'authority:1' as const,
    kind: 'propose' as const,
    generation: 'g',
    clientOperationId: 'op',
    mutation,
    ...(mutation.kind === 'clear' ? { expectedState: 'opaque' } : {}),
  })),
  { protocol: 'authority:1', kind: 'checkpoint-request', requestId: 'q', generation: 'g', cursor },
];
const server: AuthorityFrame[] = [
  {
    protocol: 'authority:1',
    kind: 'receipt',
    receipt: { generation: 'g', clientOperationId: 'op', receiptId: 'opaque' },
  },
  {
    protocol: 'authority:1',
    kind: 'rejected',
    generation: 'g',
    clientOperationId: 'op',
    reason: 'conflict',
  },
  { protocol: 'authority:1', kind: 'changes', cursor, mutations },
  { protocol: 'authority:1', kind: 'checkpoint-begin', manifest },
  { protocol: 'authority:1', kind: 'checkpoint-chunk', checkpointId: 'c', index: 0, data: 'AA==' },
  { protocol: 'authority:1', kind: 'checkpoint-end', checkpointId: 'c' },
  { protocol: 'authority:1', kind: 'resync-required', generation: 'g', reason: 'gap' },
  { protocol: 'authority:1', kind: 'upgrade-required', required: 'authority:1' },
];
const raw = (value: unknown): string => JSON.stringify(value);

describe('authority frames', () => {
  it('round-trips every frame and allowed mutation, freezes parsed JSON, and separates directions', () => {
    for (const frame of client) {
      const encoded = serializeAuthorityFrame(frame);
      const parsed = parseAuthorityClientFrame(encoded);
      expect(parsed).toEqual(frame);
      expect(parsed).not.toBe(frame);
      expect(parseAuthorityServerFrame(encoded)).toBeNull();
      expect(parseEnvelope(encoded)).toBeNull();
      expect(Object.isFrozen(parseAuthorityFrame(encoded))).toBe(true);
      expect(Object.isFrozen(frame)).toBe(false);
    }
    for (const frame of server) {
      const encoded = serializeAuthorityFrame(frame);
      expect(parseAuthorityServerFrame(encoded)).toEqual(frame);
      expect(parseAuthorityClientFrame(encoded)).toBeNull();
      expect(parseEnvelope(encoded)).toBeNull();
    }
    expect(parseAuthorityFrame(raw({ from: 'a', op: { kind: 'clear' } }))).toBeNull();
    const parsed = parseAuthorityFrame(raw(client[6]));
    if (parsed?.kind !== 'propose' || parsed.mutation.kind !== 'extension')
      throw new Error('fixture');
    expect(Object.isFrozen(parsed.mutation.payload)).toBe(true);
    expect(Object.isFrozen((parsed.mutation.payload as { nested: unknown[] }).nested)).toBe(true);
  });

  it('rejects extra metadata, bad ids, unsupported operations and CAS substitution', () => {
    const proposal = client[0];
    expect(parseAuthorityFrame(raw({ ...proposal, from: 'a' }))).toBeNull();
    expect(parseAuthorityFrame(raw({ ...proposal, generation: 'bad space' }))).toBeNull();
    expect(parseAuthorityFrame(raw({ ...proposal, expectedState: 7 }))).toBeNull();
    expect(parseAuthorityFrame(raw({ ...client[1], expectedState: cursor }))).toBeNull();
    expect(parseAuthorityFrame(raw({ ...client[1], expectedState: undefined }))).toBeNull();
    for (const kind of ['snapshot', 'presence', 'request-snapshot', 'capabilities', 'future']) {
      expect(parseAuthorityFrame(raw({ ...proposal, mutation: { kind } }))).toBeNull();
    }
    expect(
      parseAuthorityFrame(
        raw({
          ...server[0],
          receipt: {
            ...(server[0] as Extract<AuthorityFrame, { kind: 'receipt' }>).receipt,
            revision: 9,
          },
        }),
      ),
    ).toBeNull();
    expect(
      parseAuthorityFrame(raw({ ...server[2], cursor: { ...cursor, globalRevision: 99 } })),
    ).toBeNull();
    expect(parseAuthorityFrame(raw({ ...server[2], mutations: [] }))).toBeNull();
    expect(
      parseAuthorityFrame(raw({ ...server[2], mutations: Array(1025).fill(mutations[0]) })),
    ).toBeNull();
    expect(
      parseAuthorityFrame(raw({ ...client.at(-1), cursor: { ...cursor, generation: 'other' } })),
    ).toBeNull();
    expect(
      parseAuthorityFrame(raw({ ...server[3], manifest: { ...manifest, privateRevision: 4 } })),
    ).toBeNull();
    expect(
      parseAuthorityFrame(raw({ ...server[2], cursor: { ...cursor, revision: -1 } })),
    ).toBeNull();
    expect(
      parseAuthorityFrame(
        raw({ ...server[0], receipt: { generation: 'g', clientOperationId: 'o', receiptId: '' } }),
      ),
    ).toBeNull();
    expect(parseAuthorityFrame(raw({ ...server[7], required: 'authority:2' }))).toBeNull();
  });

  it('validates manifest arithmetic, inventory, digest, and canonical chunk alphabet', () => {
    const begin = (m: unknown): string =>
      raw({ protocol: 'authority:1', kind: 'checkpoint-begin', manifest: m });
    expect(
      parseAuthorityFrame(
        begin({ ...manifest, byteLength: MAX_AUTHORITY_CHECKPOINT_BYTES, chunkCount: 40 }),
      ),
    ).not.toBeNull();
    expect(
      parseAuthorityFrame(
        begin({ ...manifest, byteLength: MAX_AUTHORITY_CHECKPOINT_BYTES + 1, chunkCount: 41 }),
      ),
    ).toBeNull();
    expect(
      parseAuthorityFrame(
        begin({ ...manifest, byteLength: MAX_AUTHORITY_CHUNK_BYTES + 1, chunkCount: 1 }),
      ),
    ).toBeNull();
    expect(
      parseAuthorityFrame(
        begin({ ...manifest, extensions: [manifest.extensions[0], manifest.extensions[0]] }),
      ),
    ).toBeNull();
    expect(
      parseAuthorityFrame(
        begin({
          ...manifest,
          extensions: [{ key: 'z', pluginName: 'fog', version: 1 }, manifest.extensions[0]],
        }),
      ),
    ).toBeNull();
    for (const m of [
      { ...manifest, sha256: digest.toUpperCase() },
      { ...manifest, encoding: 'hex' },
      { ...manifest, compression: 'gzip' },
      { ...manifest, casToken: '' },
      { ...manifest, extensions: [{ key: 'a', pluginName: 'fog', version: 0 }] },
    ]) {
      expect(parseAuthorityFrame(begin(m))).toBeNull();
    }
    const chunk = (data: string, index = 0): string =>
      raw({ protocol: 'authority:1', kind: 'checkpoint-chunk', checkpointId: 'c', index, data });
    expect(
      parseAuthorityFrame(
        chunk('A'.repeat(Math.ceil(MAX_AUTHORITY_CHUNK_BYTES / 3) * 4 - 1) + '='),
      ),
    ).not.toBeNull();
    for (const data of [
      'AB==',
      'AAB=',
      'AA=',
      'AAAA=',
      'AA A',
      'A'.repeat(Math.ceil((MAX_AUTHORITY_CHUNK_BYTES + 1) / 3) * 4),
    ]) {
      expect(parseAuthorityFrame(chunk(data))).toBeNull();
    }
    expect(parseAuthorityFrame(chunk('AA==', 40))).toBeNull();
  });

  it('classifies visible batches without revealing hidden durable commits', () => {
    // Contract example: hidden durable commits between visible 7/8/9 do not appear in this cursor.
    // Filtering and cursor allocation are later server responsibilities.
    expect(classifyAuthorityCursor(cursor, { ...cursor, revision: 8 })).toBe('next');
    expect(classifyAuthorityCursor({ ...cursor, revision: 8 }, { ...cursor, revision: 9 })).toBe(
      'next',
    );
    expect(classifyAuthorityCursor(cursor, cursor)).toBe('duplicate-or-stale');
    expect(classifyAuthorityCursor(cursor, { ...cursor, revision: 10 })).toBe('gap');
    expect(classifyAuthorityCursor(cursor, { ...cursor, streamId: 'other', revision: 1 })).toBe(
      'reset-required',
    );
    expect(classifyAuthorityCursor(cursor, { ...cursor, generation: 'other', revision: 1 })).toBe(
      'reset-required',
    );
    expect(() => classifyAuthorityCursor(cursor, server[0] as never)).toThrow(TypeError);
  });
});

describe('bounded JSON', () => {
  const limits = { bytes: 100, depth: 64, nodes: 10 };
  it('rejects parsed numeric overflow and lone surrogate values or keys', () => {
    const base =
      '{"protocol":"authority:1","kind":"propose","generation":"g","clientOperationId":"o","mutation":{"kind":"extension","extensionKind":"e","payload":REPLACE}}';
    for (const payload of [
      '1e400',
      '"\\ud800"',
      '{"nested":[1e400]}',
      '{"\\ud800":1}',
      '{"nested":{"key":"\\udfff"}}',
    ]) {
      expect(() => parseAuthorityFrame(base.replace('REPLACE', payload))).not.toThrow();
      expect(parseAuthorityFrame(base.replace('REPLACE', payload))).toBeNull();
    }
    expect(parseAuthorityFrame(base.replace('REPLACE', '"\\ud83d\\ude00"'))).not.toBeNull();
    expect(parseAuthorityFrame(base.replace('REPLACE', '{"\\ud83d\\ude00":1}'))).not.toBeNull();
  });
  it('counts nodes and depth before parse', () => {
    expect(parseBoundedJson('[1,2,3]', { ...limits, nodes: 4 })).toEqual([1, 2, 3]);
    expect(parseBoundedJson('[1,2,3]', { ...limits, nodes: 3 })).toBeNull();
    expect(parseBoundedJson('[[[]]]', { ...limits, depth: 3 })).toEqual([[[]]]);
    expect(parseBoundedJson('[[[]]]', { ...limits, depth: 2 })).toBeNull();
    expect(parseBoundedJson('{bad', limits)).toBeNull();
    expect(parseBoundedJson('"😀"', { ...limits, bytes: 5 })).toBeNull();
  });

  it('writes canonical JSON without invoking accessors or toJSON', () => {
    const value = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(value, '__proto__', { enumerable: true, value: { constructor: -0 } });
    value['a'] = '\n';
    expect(serializeBoundedJson(value, { bytes: 100, depth: 4, nodes: 7 })).toBe(
      '{"__proto__":{"constructor":0},"a":"\\n"}',
    );
    expect(Object.isFrozen(value)).toBe(false);
    const getter = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get: () => {
        throw new Error('sentinel');
      },
    });
    expect(() => serializeBoundedJson(getter, limits)).toThrow(TypeError);
    const sparse = [1, 2];
    delete sparse[0];
    const extraArray = [1];
    Object.assign(extraArray, { note: 'unexpected' });
    const hidden = Object.defineProperty({}, 'hidden', { value: 1 });
    const symbolKey = { [Symbol('hidden')]: 1 };
    for (const invalid of [
      Infinity,
      NaN,
      undefined,
      1n,
      Symbol('x'),
      new Date(),
      '\ud800',
      sparse,
      extraArray,
      hidden,
      symbolKey,
      {
        toJSON() {
          throw new Error('sentinel');
        },
      },
    ]) {
      expect(() => serializeBoundedJson(invalid, limits)).toThrow(TypeError);
    }
    const cycle: unknown[] = [];
    cycle.push(cycle);
    expect(() => serializeBoundedJson(cycle, limits)).toThrow(TypeError);
    expect(() => serializeBoundedJson({ x: 'a'.repeat(100) }, limits)).toThrow(RangeError);
  });

  it('rejects oversized array/object before full own-key reflection or element descriptors', () => {
    const dense = Array(10_000).fill(0) as number[];
    const many = Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [`k${i}`, 0]));
    const extra = Object.assign([], many) as unknown[];
    const hiddenOnly = Object.defineProperty({}, 'hidden', { value: 1 });
    const protectedTargets: unknown[] = [dense, many, extra, hiddenOnly];
    const ownNames = Object.getOwnPropertyNames;
    const ownSymbols = Object.getOwnPropertySymbols;
    const ownKeys = Reflect.ownKeys;
    const keys = Object.keys;
    const descriptor = Object.getOwnPropertyDescriptor;
    const namesSpy = vi.spyOn(Object, 'getOwnPropertyNames').mockImplementation((target) => {
      if (protectedTargets.includes(target)) throw new Error('full inventory');
      return ownNames(target);
    });
    const symbolsSpy = vi.spyOn(Object, 'getOwnPropertySymbols').mockImplementation((target) => {
      if (protectedTargets.includes(target)) throw new Error('full inventory');
      return ownSymbols(target);
    });
    const ownKeysSpy = vi.spyOn(Reflect, 'ownKeys').mockImplementation((target) => {
      if (protectedTargets.includes(target)) throw new Error('full inventory');
      return ownKeys(target);
    });
    const keysSpy = vi.spyOn(Object, 'keys').mockImplementation((target) => {
      if (protectedTargets.includes(target)) throw new Error('full inventory');
      return keys(target);
    });
    const descriptorSpy = vi
      .spyOn(Object, 'getOwnPropertyDescriptor')
      .mockImplementation((target, key) => {
        if (
          target === many ||
          target === hiddenOnly ||
          (target === dense && key !== 'length') ||
          (target === extra && key !== 'length')
        )
          throw new Error('early descriptor');
        return descriptor(target, key);
      });
    try {
      expect(() => serializeBoundedJson(dense, { bytes: 20, depth: 4, nodes: 5 })).toThrow(
        RangeError,
      );
      expect(() => serializeBoundedJson(many, { bytes: 20, depth: 4, nodes: 5 })).toThrow(
        RangeError,
      );
      expect(() => serializeBoundedJson(extra, { bytes: 20, depth: 4, nodes: 5 })).toThrow(
        TypeError,
      );
      expect(() => serializeBoundedJson(hiddenOnly, { bytes: 1, depth: 4, nodes: 5 })).toThrow(
        RangeError,
      );
    } finally {
      descriptorSpy.mockRestore();
      keysSpy.mockRestore();
      ownKeysSpy.mockRestore();
      symbolsSpy.mockRestore();
      namesSpy.mockRestore();
    }
  });

  it('enforces exact array/object node and encoded byte budgets', () => {
    for (const value of [[0, 0], { a: 0 }, { é: 0 }, { '\n': 0 }]) {
      const encoded = serializeBoundedJson(value, { bytes: 100, depth: 4, nodes: 10 });
      const bytes = new TextEncoder().encode(encoded).length;
      expect(serializeBoundedJson(value, { bytes, depth: 4, nodes: 3 })).toBe(encoded);
      expect(() => serializeBoundedJson(value, { bytes: bytes - 1, depth: 4, nodes: 3 })).toThrow(
        RangeError,
      );
      expect(() => serializeBoundedJson(value, { bytes, depth: 4, nodes: 2 })).toThrow(RangeError);
    }
  });

  it('enforces encoded frame bytes including multibyte content', () => {
    const base = {
      protocol: 'authority:1',
      kind: 'propose',
      generation: 'g',
      clientOperationId: 'o',
      mutation: { kind: 'extension', extensionKind: 'e', payload: '' },
    };
    const overhead = new TextEncoder().encode(raw(base)).length;
    const exact = {
      ...base,
      mutation: { ...base.mutation, payload: 'x'.repeat(MAX_AUTHORITY_FRAME_BYTES - overhead) },
    };
    expect(parseAuthorityFrame(raw(exact))).not.toBeNull();
    expect(
      parseAuthorityFrame(
        raw({ ...exact, mutation: { ...exact.mutation, payload: `${exact.mutation.payload}x` } }),
      ),
    ).toBeNull();
    expect(serializeAuthorityFrame(exact as AuthorityFrame).length).toBe(MAX_AUTHORITY_FRAME_BYTES);
    expect(
      parseAuthorityFrame(
        raw({ ...base, mutation: { ...base.mutation, payload: '😀'.repeat(270_000) } }),
      ),
    ).toBeNull();
  });

  it('limits frame depth and keeps serializer diagnostics generic', () => {
    const base = {
      protocol: 'authority:1',
      kind: 'propose',
      generation: 'g',
      clientOperationId: 'o',
      mutation: { kind: 'extension', extensionKind: 'e', payload: null as unknown },
    };
    let within: unknown = null;
    for (let i = 0; i < 62; i += 1) within = [within];
    const valid = { ...base, mutation: { ...base.mutation, payload: within } };
    expect(parseAuthorityFrame(raw(valid))).not.toBeNull();
    expect(
      parseAuthorityFrame(raw({ ...valid, mutation: { ...valid.mutation, payload: [within] } })),
    ).toBeNull();
    const sentinel = 'private-sentinel-123';
    try {
      serializeAuthorityFrame({ ...base, generation: sentinel + ' ' } as AuthorityFrame);
      throw new Error('Expected serializer rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      expect(String(error)).not.toContain(sentinel);
    }
  });
});
