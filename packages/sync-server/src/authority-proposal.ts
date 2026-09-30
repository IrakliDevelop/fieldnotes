import { createHash } from 'node:crypto';
import {
  parseAuthorityClientFrame,
  serializeAuthorityFrame,
  type AuthorityClientFrame,
} from '@fieldnotes/sync';
import { snapshotAuthContext, validateExpiresAt, type AuthContext } from './auth-context';
import { isValidRoomName } from './room-name';

export type AuthorityProposalFrame = Extract<AuthorityClientFrame, { kind: 'propose' }>;

/** Admitted server identity. actorId must remain stable across reconnects. */
export interface AuthorityProposalActor {
  readonly room: string;
  readonly actorId: string;
  readonly connectionId: string;
  readonly userId?: string;
  readonly role?: string;
  readonly authContext?: AuthContext;
  readonly expiresAt?: number;
  readonly deadlineAt: number;
  /** A native signal from this Node realm; this helper does not alter it. */
  readonly signal: AbortSignal;
}

/** A validated original request, not an authorized commit intent. */
export interface AuthorityProposalContext extends AuthorityProposalActor {
  readonly roomGeneration: string;
  readonly clientOperationId: string;
  readonly operationDigest: string;
}

export interface PreparedAuthorityProposal {
  readonly context: AuthorityProposalContext;
  readonly proposal: AuthorityProposalFrame;
}

const INVALID = 'Invalid authority proposal';
const EXPIRED = 'Authority proposal expired';
const MAX_ID_BYTES = 1024;
const MAX_PREPARATION_MS = 5000;
const SIGNAL_ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;

function invalid(): never {
  throw new TypeError(INVALID);
}

function ownValue(record: object, key: string, required: boolean): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) {
    if (required) invalid();
    return undefined;
  }
  if (!descriptor.enumerable || !('value' in descriptor)) invalid();
  return descriptor.value;
}

function boundedString(value: unknown, required: boolean): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value.length > MAX_ID_BYTES || (required && !value.length)) {
    invalid();
  }
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (++i >= value.length || value.charCodeAt(i) < 0xdc00 || value.charCodeAt(i) > 0xdfff)
        invalid();
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      invalid();
    }
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_ID_BYTES) invalid();
  return value;
}

function checkedActor(value: unknown): AuthorityProposalActor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) invalid();
  if (Reflect.ownKeys(value).some((key) => typeof key === 'symbol')) invalid();

  const room = ownValue(value, 'room', true);
  if (!isValidRoomName(room)) invalid();
  const actorId = boundedString(ownValue(value, 'actorId', true), true);
  const connectionId = boundedString(ownValue(value, 'connectionId', true), true);
  if (actorId === undefined || connectionId === undefined) invalid();
  const userId = boundedString(ownValue(value, 'userId', false), false);
  const role = boundedString(ownValue(value, 'role', false), false);
  const authContext = ownValue(value, 'authContext', false) as AuthContext | undefined;
  const expiresAt = validateExpiresAt(ownValue(value, 'expiresAt', false));
  const deadlineAt = ownValue(value, 'deadlineAt', true);
  if (typeof deadlineAt !== 'number' || !Number.isSafeInteger(deadlineAt) || deadlineAt <= 0)
    invalid();
  const signal = ownValue(value, 'signal', true);
  if (!(signal instanceof AbortSignal) || !SIGNAL_ABORTED) invalid();
  // Invoke the native brand-checked getter, never a caller-installed override.
  SIGNAL_ABORTED.call(signal);
  return {
    room,
    actorId,
    connectionId,
    ...(userId === undefined ? {} : { userId }),
    ...(role === undefined ? {} : { role }),
    ...(authContext === undefined ? {} : { authContext }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    deadlineAt,
    signal,
  };
}

function expired(signal: AbortSignal, deadlineAt: number, expiresAt: number | undefined): boolean {
  return (
    SIGNAL_ABORTED?.call(signal) === true ||
    Date.now() >= deadlineAt ||
    (expiresAt !== undefined && Date.now() >= expiresAt)
  );
}

/** Prepare a bounded, immutable request. The future driver must reauthorize and commit atomically. */
export function prepareAuthorityProposal(
  actor: AuthorityProposalActor,
  message: string,
): PreparedAuthorityProposal {
  let admitted: AuthorityProposalActor;
  try {
    admitted = checkedActor(actor);
  } catch {
    return invalid();
  }

  const entryNow = Date.now();
  if (
    SIGNAL_ABORTED?.call(admitted.signal) === true ||
    entryNow >= admitted.deadlineAt ||
    (admitted.expiresAt !== undefined && entryNow >= admitted.expiresAt)
  ) {
    throw new Error(EXPIRED);
  }
  const deadlineAt = Math.min(
    admitted.deadlineAt,
    entryNow + MAX_PREPARATION_MS,
    admitted.expiresAt ?? Infinity,
  );

  let result: PreparedAuthorityProposal;
  try {
    const authContext = snapshotAuthContext(admitted.authContext);
    const frame = parseAuthorityClientFrame(message);
    if (frame?.kind !== 'propose') invalid();
    const canonical = serializeAuthorityFrame(frame);
    const operationDigest = createHash('sha256')
      .update('fieldnotes.authority-proposal.v1\0', 'utf8')
      .update(JSON.stringify([admitted.room, admitted.actorId]), 'utf8')
      .update('\0', 'utf8')
      .update(canonical, 'utf8')
      .digest('hex');
    const context: AuthorityProposalContext = Object.freeze({
      room: admitted.room,
      actorId: admitted.actorId,
      connectionId: admitted.connectionId,
      ...(admitted.userId === undefined ? {} : { userId: admitted.userId }),
      ...(admitted.role === undefined ? {} : { role: admitted.role }),
      ...(authContext === undefined ? {} : { authContext }),
      ...(admitted.expiresAt === undefined ? {} : { expiresAt: admitted.expiresAt }),
      deadlineAt,
      signal: admitted.signal,
      roomGeneration: frame.generation,
      clientOperationId: frame.clientOperationId,
      operationDigest,
    });
    result = Object.freeze({ context, proposal: frame });
  } catch {
    return invalid();
  }
  if (expired(admitted.signal, deadlineAt, admitted.expiresAt)) throw new Error(EXPIRED);
  return result;
}
