import { describe, expect, it, vi } from 'vitest';
import { prepareAuthorityCheckpoint } from '@fieldnotes/sync';
import { createHash } from 'node:crypto';
import { hashAuthorityJson, measureAuthorityJson } from './authority-json';

describe('authority visible hash', () => {
  it('uses canonical key order and excludes no supplied visible field', () => {
    const canonical = '{"a":[true,null],"b":{"x":1,"z":"é"}}';
    const expected = createHash('sha256').update(canonical).digest('hex');
    expect(hashAuthorityJson({ b: { z: 'é', x: 1 }, a: [true, null] })).toBe(expected);
    expect(hashAuthorityJson({ a: [true, null], b: { x: 1, z: 'é' } })).toBe(expected);
    expect(hashAuthorityJson({ a: [false, null], b: { x: 1, z: 'é' } })).not.toBe(expected);
  });

  it('rejects accessor and cycles without executing application getters', () => {
    const value = { safe: true } as Record<string, unknown>;
    Object.defineProperty(value, 'secret', {
      enumerable: true,
      get: () => {
        throw new Error('executed');
      },
    });
    expect(() => hashAuthorityJson(value)).toThrow('Invalid authority JSON object');
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    expect(() => hashAuthorityJson(cycle)).toThrow();
  });

  it('enforces complete-image bytes, depth, sparse arrays and JSON scalars', () => {
    expect(() => hashAuthorityJson({ data: 'x'.repeat(20 * 1024 * 1024) })).toThrow(RangeError);
    let nested: unknown = null;
    for (let index = 0; index < 65; index++) nested = [nested];
    expect(() => hashAuthorityJson(nested)).toThrow(RangeError);
    const sparse = Array.from({ length: 2 });
    delete sparse[0];
    expect(() => hashAuthorityJson(sparse)).toThrow();
    expect(() => hashAuthorityJson({ value: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => hashAuthorityJson({ malformed: '\ud800' })).toThrow(TypeError);
    expect(() => hashAuthorityJson({ unsupported: undefined })).toThrow(TypeError);
  });

  it('rejects hidden enumerable inventory and non-plain prototypes', () => {
    const symbolKey = { safe: 1 } as Record<string | symbol, unknown>;
    symbolKey[Symbol('secret')] = 2;
    expect(() => hashAuthorityJson(symbolKey)).toThrow();
    const nonPlain = Object.create({ inherited: 1 }) as Record<string, unknown>;
    nonPlain['own'] = 2;
    expect(() => hashAuthorityJson(nonPlain)).toThrow();
    const array = [1] as number[] & { extra?: number };
    array.extra = 2;
    expect(() => hashAuthorityJson(array)).toThrow();
  });

  it('counts actual high-node writer parts, key inventories, and array index units', () => {
    const emptyArrays = Array.from({ length: 999_999 }, () => []);
    const measured = measureAuthorityJson(emptyArrays);
    expect(measured.nodes).toBe(1_000_000);
    expect(measured.writerParts).toBe(2_999_998);
    expect(measured.arrayIndexStringUnits).toBe(5_888_884);
    expect(measured.peakInventoryEntries).toBe(1_000_000);
    console.info(
      `high-node JSON: ${measured.bytes} bytes, ${measured.nodes} nodes, ${measured.writerParts} writer parts, ${measured.arrayIndexStringUnits} array-index units`,
    );
    expect(() => measureAuthorityJson([...emptyArrays, []])).toThrow(RangeError);
    const wide = Object.fromEntries(
      Array.from({ length: 20_000 }, (_, index) => [`k${index}`, [true, { x: 'é\\\n' }]]),
    );
    const mixed = measureAuthorityJson(wide);
    expect(mixed.nodes).toBe(120_001);
    expect(mixed.writerParts).toBeLessThanOrEqual(3 * mixed.nodes - 1);
    expect(mixed.peakInventoryEntries).toBe(40_000); // transient Reflect inventory overlaps the pending keys
    expect(mixed.bytes).toBe(Buffer.byteLength(JSON.stringify(wide), 'utf8'));
  }, 30_000);

  it('preflights the complete cursor/CAS payload at the exact byte edge before C2', async () => {
    const cursor = { generation: 'g', streamId: 's'.repeat(32), revision: 0 };
    const casToken = 'Ab'.repeat(32);
    const requirement = { key: 'wide', pluginName: 'test', version: 1, validate: () => true };
    const makePayload = (text: string) => ({
      cursor,
      casToken,
      elements: [],
      layers: [],
      extensions: { wide: { pluginName: 'test', version: 1, data: { text } } },
    });
    const base = measureAuthorityJson(makePayload(''));
    const exact = makePayload('x'.repeat(20_971_520 - base.bytes));
    expect(measureAuthorityJson(exact).bytes).toBe(20_971_520);
    const prepared = await prepareAuthorityCheckpoint(exact, {
      requestId: 'request',
      checkpointId: 'checkpoint',
      requiredExtensions: [requirement],
    });
    expect(prepared.manifest.byteLength).toBe(20_971_520);
    prepared.dispose();
    expect(() => measureAuthorityJson(makePayload(`${exact.extensions.wide.data.text}x`))).toThrow(
      RangeError,
    );
  }, 30_000);

  it('admits simultaneous near-byte and near-node payloads with measured C2 writer parts', async () => {
    const nodes = Array.from({ length: 999_900 }, () => []);
    const cursor = { generation: 'g', streamId: 's'.repeat(32), revision: 0 };
    const makePayload = (text: string) => ({
      cursor,
      elements: [],
      layers: [],
      extensions: { many: { pluginName: 'test', version: 1, data: { nodes, text } } },
    });
    const base = measureAuthorityJson(makePayload(''));
    const payload = makePayload('x'.repeat(20_971_520 - 1024 - base.bytes));
    const measured = measureAuthorityJson(payload);
    expect(measured.bytes).toBe(20_971_520 - 1024);
    expect(measured.nodes).toBeGreaterThan(999_900);
    expect(measured.writerParts).toBeLessThanOrEqual(3 * measured.nodes - 1);
    expect(measured.arrayIndexStringUnits).toBeGreaterThan(5_800_000);
    const prepared = await prepareAuthorityCheckpoint(payload, {
      requestId: 'request',
      checkpointId: 'checkpoint',
      requiredExtensions: [{ key: 'many', pluginName: 'test', version: 1, validate: () => true }],
    });
    expect(prepared.manifest.byteLength).toBe(measured.bytes);
    console.info(
      `combined JSON: ${measured.bytes} bytes, ${measured.nodes} nodes, ${measured.writerParts} writer parts, ${measured.arrayIndexStringUnits} array-index units`,
    );
    prepared.dispose();
  }, 60_000);

  it('measures the maximum prepared extension inventory under the fixed metadata allowance', async () => {
    const entries = Array.from({ length: 256 }, (_, index) => ({
      key: `${String(index).padStart(3, '0')}${'k'.repeat(125)}`,
      pluginName: 'p'.repeat(128),
      version: 1,
    }));
    const extensions = Object.fromEntries(
      entries.map((entry) => [
        entry.key,
        {
          pluginName: entry.pluginName,
          version: 1,
          data: null,
        },
      ]),
    );
    const payload = {
      cursor: { generation: 'g', streamId: 's'.repeat(32), revision: 0 },
      casToken: 'a'.repeat(64),
      elements: [],
      layers: [],
      extensions,
    };
    const prepared = await prepareAuthorityCheckpoint(payload, {
      requestId: 'r'.repeat(128),
      checkpointId: 'c'.repeat(128),
      requiredExtensions: entries.map((entry) => ({ ...entry, validate: () => true })),
    });
    const manifest = measureAuthorityJson(prepared.manifest);
    const metadataStringBytes = 2 * manifest.stringUnits;
    const auxiliaryEntries = entries.length * 3 + manifest.peakInventoryEntries + manifest.maxDepth;
    expect(prepared.manifest.extensions).toHaveLength(256);
    expect(metadataStringBytes).toBeLessThan(256 * 1024);
    expect(auxiliaryEntries).toBeLessThan(65_536);
    expect(manifest.bytes).toBeLessThan(1024 * 1024);
    const begin = prepared.frames.next();
    expect(begin.done).toBe(false);
    if (!begin.done)
      expect(Buffer.byteLength(JSON.stringify(begin.value), 'utf8')).toBeLessThan(1024 * 1024);
    console.info(
      `max metadata: ${metadataStringBytes} string bytes, ${auxiliaryEntries} auxiliary entries, ${manifest.bytes} canonical bytes`,
    );
    prepared.dispose();
  }, 30_000);

  it('rejects an escaped oversized value or key before quote materialization', () => {
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      expect(() => measureAuthorityJson('\\n'.repeat(11_000_000))).toThrow(RangeError);
      expect(stringify).not.toHaveBeenCalled();
      const hugeKey = '"'.repeat(11_000_000);
      expect(() => measureAuthorityJson({ [hugeKey]: null })).toThrow(RangeError);
      expect(stringify).not.toHaveBeenCalled();
    } finally {
      stringify.mockRestore();
    }
  });

  it('matches JSON.stringify byte lengths for Unicode and every escape class', () => {
    for (const sample of ['é', '🪐', '\u0000', '\b', '\n', '\f', '\r', '\t', '"', '\\', '\u2028']) {
      const value = { [sample]: sample };
      expect(measureAuthorityJson(value).bytes).toBe(
        Buffer.byteLength(JSON.stringify(value), 'utf8'),
      );
    }
    expect(() => measureAuthorityJson({ bad: '\ud800' })).toThrow(TypeError);
    expect(() => measureAuthorityJson({ bad: '\udc00' })).toThrow(TypeError);
  });

  it('hashes long quoted values and keys in bounded fragments without quoting during measurement', () => {
    const text = `${'x'.repeat(8191)}🪐${'\\n"é'.repeat(30_000)}`;
    const value = { [text]: text };
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      const measured = measureAuthorityJson(value);
      expect(stringify).not.toHaveBeenCalled();
      const expected = createHash('sha256').update(JSON.stringify(value)).digest('hex');
      stringify.mockClear();
      expect(hashAuthorityJson(value)).toBe(expected);
      expect(measured.writerParts).toBe(5);
      expect(
        Math.max(...stringify.mock.calls.map(([part]) => String(part).length)),
      ).toBeLessThanOrEqual(8192);
    } finally {
      stringify.mockRestore();
    }
  });

  it('bounds pending ancestor and ordinary array inventories before Reflect allocates them', () => {
    const child = Object.fromEntries(
      Array.from({ length: 400 }, (_, index) => [`c${index}`, null]),
    );
    const root: Record<string, unknown> = Object.fromEntries(
      Array.from({ length: 400 }, (_, index) => [`r${index}`, null]),
    );
    root['a'] = child;
    const ownKeys = vi.spyOn(Reflect, 'ownKeys');
    try {
      expect(() => measureAuthorityJson(root, 20_971_520, 1000)).toThrow(RangeError);
      expect(ownKeys.mock.calls.some(([value]) => value === child)).toBe(false);
      const validChild = Object.fromEntries(
        Array.from({ length: 200 }, (_, index) => [`c${index}`, null]),
      );
      const validRoot: Record<string, unknown> = Object.fromEntries(
        Array.from({ length: 200 }, (_, index) => [`r${index}`, null]),
      );
      validRoot['a'] = validChild;
      const measured = measureAuthorityJson(validRoot, 20_971_520, 1000);
      expect(measured.peakInventoryEntries).toBeLessThanOrEqual(measured.nodes + 64);
      ownKeys.mockClear();
      const array = [1] as number[] & { extra?: number };
      array.extra = 2;
      expect(() => measureAuthorityJson(array)).toThrow('Invalid authority JSON array');
      expect(ownKeys.mock.calls.some(([value]) => value === array)).toBe(false);
    } finally {
      ownKeys.mockRestore();
    }
  });
});
