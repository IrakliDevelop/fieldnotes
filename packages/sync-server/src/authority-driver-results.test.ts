import { describe, expect, it } from 'vitest';
import {
  assertAuthorityLeaseHeader,
  assertAuthorityReadPage,
  isAuthorityPosition,
} from './authority-driver-results';

const cut = { generation: 'g', revision: 'cut' };
const one = { generation: 'g', revision: 'opaque:β' };
const two = { generation: 'g', revision: 'not-a-number' };
const ref = { id: 'ref', byteLength: 1, nodes: 1 };
const record = (
  previous: unknown,
  position: unknown,
  before: unknown = ref,
  after: unknown = ref,
) => ({ previous, position, before, after });

describe('authority driver result validation', () => {
  it('accepts opaque UTF-8 position boundaries and rejects oversized or malformed positions', () => {
    expect(isAuthorityPosition({ generation: 'é'.repeat(64), revision: 'r'.repeat(128) })).toBe(
      true,
    );
    for (const position of [
      null,
      { generation: '', revision: 'r' },
      { generation: 'é'.repeat(65), revision: 'r' },
      { generation: 'g', revision: 'é'.repeat(65) },
      { generation: 'g', revision: 2 },
    ])
      expect(isAuthorityPosition(position)).toBe(false);
  });

  it.each([
    ['one opaque record', { status: 'ok', head: one, records: [record(cut, one)] }],
    [
      'partial opaque page',
      {
        status: 'ok',
        head: { generation: 'g', revision: 'later' },
        records: [record(cut, one), record(one, two)],
      },
    ],
    ['empty unchanged page', { status: 'ok', head: cut, records: [] }],
    ['typed gap', { status: 'gap', head: one }],
    [
      'replacement generation',
      { status: 'ok', head: { generation: 'replacement', revision: 'r' }, records: null },
    ],
    [
      'valid record and position bounds',
      {
        status: 'ok',
        head: { generation: 'g', revision: 'r'.repeat(128) },
        records: [
          record(
            cut,
            { generation: 'g', revision: 'r'.repeat(128) },
            { id: 'x'.repeat(128), byteLength: 20 * 1024 * 1024, nodes: 1_000_000 },
            { id: 'r', byteLength: 0, nodes: 1 },
          ),
        ],
      },
    ],
  ])('accepts %s', (_label, page) => {
    expect(() => assertAuthorityReadPage(cut, page)).not.toThrow();
  });

  it.each([
    ['null page', null],
    ['unknown status', { status: 'typo', head: cut }],
    ['invalid head', { status: 'gap', head: null }],
    ['missing records', { status: 'ok', head: cut }],
    ['empty mismatch', { status: 'ok', head: one, records: [] }],
    ['self-link', { status: 'ok', head: one, records: [record(cut, cut)] }],
    [
      'two-record cycle',
      { status: 'ok', head: two, records: [record(cut, one), record(one, cut)] },
    ],
    [
      'three-record cycle',
      { status: 'ok', head: two, records: [record(cut, one), record(one, two), record(two, one)] },
    ],
    [
      'late broken previous',
      { status: 'ok', head: two, records: [record(cut, one), record(cut, two)] },
    ],
    [
      'early visited head',
      { status: 'ok', head: one, records: [record(cut, one), record(one, two)] },
    ],
    [
      'cross generation',
      { status: 'ok', head: two, records: [record(cut, { generation: 'other', revision: 'r' })] },
    ],
    ['missing ref', { status: 'ok', head: one, records: [record(cut, one, null)] }],
    [
      'oversized ref id',
      { status: 'ok', head: one, records: [record(cut, one, { ...ref, id: 'x'.repeat(129) })] },
    ],
    [
      'invalid ref bytes',
      {
        status: 'ok',
        head: one,
        records: [record(cut, one, { ...ref, byteLength: 20 * 1024 * 1024 + 1 })],
      },
    ],
    [
      'invalid ref nodes',
      { status: 'ok', head: one, records: [record(cut, one, ref, { ...ref, nodes: 0 })] },
    ],
    [
      'nine records',
      { status: 'ok', head: one, records: Array.from({ length: 9 }, () => record(cut, one)) },
    ],
    [
      'oversized bytes',
      {
        status: 'ok',
        head: one,
        records: [record(cut, one, { ...ref, unused: 'x'.repeat(65536) })],
      },
    ],
  ])('rejects %s', (_label, page) => {
    expect(() => assertAuthorityReadPage(cut, page)).toThrow();
  });

  it('uses the same existing header rules for evidence and capture inputs', () => {
    const now = 1000;
    const release = async () => undefined;
    const valid = { token: 'é'.repeat(128), expiresAt: now + 1, release };
    expect(() => assertAuthorityLeaseHeader(valid, now)).not.toThrow();
    for (const header of [
      null,
      { ...valid, release: null },
      { ...valid, token: undefined },
      { ...valid, token: '' },
      { ...valid, token: 'x'.repeat(129) },
      { ...valid, token: 5 },
      { ...valid, expiresAt: undefined },
      { ...valid, expiresAt: NaN },
      { ...valid, expiresAt: Infinity },
      { ...valid, expiresAt: now + 0.5 },
      { ...valid, expiresAt: now },
    ])
      expect(() => assertAuthorityLeaseHeader(header, now)).toThrow();
  });
});
