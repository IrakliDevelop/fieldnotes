import type { AuthorityPosition, AuthorityReadPage } from './authority-types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isAuthorityPosition(value: unknown): value is AuthorityPosition {
  return (
    isRecord(value) &&
    typeof value.generation === 'string' &&
    value.generation.length > 0 &&
    Buffer.byteLength(value.generation, 'utf8') <= 128 &&
    typeof value.revision === 'string' &&
    value.revision.length > 0 &&
    Buffer.byteLength(value.revision, 'utf8') <= 128
  );
}

function samePosition(a: AuthorityPosition, b: AuthorityPosition): boolean {
  return a.generation === b.generation && a.revision === b.revision;
}

function validEvidenceRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.id.length <= 128 &&
    typeof value.byteLength === 'number' &&
    Number.isSafeInteger(value.byteLength) &&
    value.byteLength >= 0 &&
    value.byteLength <= 20 * 1024 * 1024 &&
    typeof value.nodes === 'number' &&
    Number.isSafeInteger(value.nodes) &&
    value.nodes > 0 &&
    value.nodes <= 1_000_000
  );
}

/** Validate the entire bounded path before the runtime may consume any evidence. */
export function assertAuthorityReadPage(
  cut: AuthorityPosition,
  value: unknown,
): asserts value is AuthorityReadPage {
  if (!isRecord(value) || !isAuthorityPosition(value.head))
    throw new TypeError('Invalid authority page');
  if (value.status === 'gap') return;
  if (value.status !== 'ok') throw new TypeError('Invalid authority page status');
  // A replacement generation is reconciled without using its records.
  if (value.head.generation !== cut.generation) return;
  if (!Array.isArray(value.records) || value.records.length > 8)
    throw new TypeError('Invalid authority page records');
  if (Buffer.byteLength(JSON.stringify(value.records), 'utf8') > 64 * 1024)
    throw new TypeError('Invalid authority page bytes');
  if (value.records.length === 0 && !samePosition(cut, value.head))
    throw new TypeError('Invalid authority empty page');
  const visited = new Set<string>([JSON.stringify([cut.generation, cut.revision])]);
  let previous = cut;
  for (const record of value.records) {
    if (
      !isRecord(record) ||
      !isAuthorityPosition(record.previous) ||
      !isAuthorityPosition(record.position) ||
      record.previous.generation !== cut.generation ||
      record.position.generation !== cut.generation ||
      !samePosition(record.previous, previous) ||
      !validEvidenceRef(record.before) ||
      !validEvidenceRef(record.after)
    )
      throw new TypeError('Invalid authority history');
    const key = JSON.stringify([record.position.generation, record.position.revision]);
    if (visited.has(key)) throw new TypeError('Cyclic authority history');
    visited.add(key);
    previous = record.position;
  }
  const headKey = JSON.stringify([value.head.generation, value.head.revision]);
  if (value.records.length && visited.has(headKey) && !samePosition(previous, value.head))
    throw new TypeError('Invalid authority page head');
}

export function assertAuthorityLeaseHeader(
  value: unknown,
  now: number,
): asserts value is {
  readonly token: string;
  readonly expiresAt: number;
  release(): Promise<void>;
} {
  if (
    !isRecord(value) ||
    typeof value.release !== 'function' ||
    typeof value.token !== 'string' ||
    value.token.length < 1 ||
    value.token.length > 128 ||
    typeof value.expiresAt !== 'number' ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= now
  )
    throw new TypeError('Invalid authority lease');
}
