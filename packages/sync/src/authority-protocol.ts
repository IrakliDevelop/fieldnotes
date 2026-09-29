import { isValidEnvelope } from './protocol';
import type { SyncOp } from './protocol';
import { freezeJson, parseBoundedJson, serializeBoundedJson } from './authority-json';

export const AUTHORITY_PROTOCOL_VERSION = 1;
export const MAX_AUTHORITY_FRAME_BYTES = 1_048_576;
export const MAX_AUTHORITY_CHECKPOINT_BYTES = 20_971_520;
export const MAX_AUTHORITY_CHUNK_BYTES = 524_288;
export const AUTHORITY_CHECKPOINT_TIMEOUT_MS = 10_000;
export const MAX_AUTHORITY_JSON_DEPTH = 64;
export const MAX_AUTHORITY_JSON_NODES = 1_000_000;

const FRAME_LIMITS = {
  bytes: MAX_AUTHORITY_FRAME_BYTES,
  depth: MAX_AUTHORITY_JSON_DEPTH,
  nodes: MAX_AUTHORITY_JSON_NODES,
} as const;

type DurableSyncOp = Extract<
  SyncOp,
  {
    kind:
      | 'upsert'
      | 'remove'
      | 'clear'
      | 'layer-upsert'
      | 'layer-remove'
      | 'fog-meta'
      | 'fog-patch'
      | 'extension';
  }
>;
type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
export type AuthorityMutation = DeepReadonly<DurableSyncOp>;

export interface AuthorityCursor {
  readonly generation: string;
  readonly streamId: string;
  readonly revision: number;
}

export interface AuthorityReceipt {
  readonly generation: string;
  readonly clientOperationId: string;
  readonly receiptId: string;
}

export interface AuthorityExtensionManifestEntry {
  readonly key: string;
  readonly pluginName: string;
  readonly version: number;
}

export interface AuthorityCheckpointManifest {
  readonly requestId: string;
  readonly checkpointId: string;
  readonly cursor: AuthorityCursor;
  readonly encoding: 'base64';
  readonly compression: 'none';
  readonly byteLength: number;
  readonly chunkBytes: 524288;
  readonly chunkCount: number;
  readonly sha256: string;
  readonly extensions: readonly AuthorityExtensionManifestEntry[];
  readonly casToken?: string;
}

export type AuthorityRejectionReason =
  | 'forbidden'
  | 'invalid'
  | 'generation-mismatch'
  | 'conflict'
  | 'expired'
  | 'overloaded'
  | 'unsupported-extension'
  | 'operation-id-reused'
  | 'retry-window-expired';
export type AuthorityResyncReason =
  | 'delivery-failed'
  | 'gap'
  | 'stream-reset'
  | 'checkpoint-required';

export type AuthorityClientFrame =
  | {
      readonly protocol: 'authority:1';
      readonly kind: 'propose';
      readonly generation: string;
      readonly clientOperationId: string;
      readonly mutation: AuthorityMutation;
      readonly expectedState?: string;
    }
  | {
      readonly protocol: 'authority:1';
      readonly kind: 'checkpoint-request';
      readonly requestId: string;
      readonly generation: string;
      readonly cursor?: AuthorityCursor;
    };

export type AuthorityServerFrame =
  | {
      readonly protocol: 'authority:1';
      readonly kind: 'receipt';
      readonly receipt: AuthorityReceipt;
    }
  | {
      readonly protocol: 'authority:1';
      readonly kind: 'rejected';
      readonly generation: string;
      readonly clientOperationId: string;
      readonly reason: AuthorityRejectionReason;
    }
  | {
      readonly protocol: 'authority:1';
      readonly kind: 'changes';
      readonly cursor: AuthorityCursor;
      readonly mutations: readonly AuthorityMutation[];
    }
  | {
      readonly protocol: 'authority:1';
      readonly kind: 'checkpoint-begin';
      readonly manifest: AuthorityCheckpointManifest;
    }
  | {
      readonly protocol: 'authority:1';
      readonly kind: 'checkpoint-chunk';
      readonly checkpointId: string;
      readonly index: number;
      readonly data: string;
    }
  | {
      readonly protocol: 'authority:1';
      readonly kind: 'checkpoint-end';
      readonly checkpointId: string;
    }
  | {
      readonly protocol: 'authority:1';
      readonly kind: 'resync-required';
      readonly generation: string;
      readonly reason: AuthorityResyncReason;
    }
  | {
      readonly protocol: 'authority:1';
      readonly kind: 'upgrade-required';
      readonly required: 'authority:1';
    };

export type AuthorityFrame = AuthorityClientFrame | AuthorityServerFrame;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (!record(value)) return false;
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function id(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    /^[\x21-\x7e]+$/.test(value)
  );
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

export function isAuthorityCursor(value: unknown): value is AuthorityCursor {
  return (
    exact(value, ['generation', 'streamId', 'revision']) &&
    id(value['generation']) &&
    id(value['streamId']) &&
    integer(value['revision'], 0)
  );
}

function receipt(value: unknown): value is AuthorityReceipt {
  return (
    exact(value, ['generation', 'clientOperationId', 'receiptId']) &&
    id(value['generation']) &&
    id(value['clientOperationId']) &&
    id(value['receiptId'])
  );
}

const MUTATION_SHAPES: Record<string, readonly string[]> = {
  upsert: ['kind', 'element'],
  remove: ['kind', 'id'],
  clear: ['kind'],
  'layer-upsert': ['kind', 'layer', 'version', 'editor'],
  'layer-remove': ['kind', 'id', 'version', 'editor'],
  'fog-meta': ['kind', 'record'],
  'fog-patch': ['kind', 'generation', 'tiles'],
  extension: ['kind', 'extensionKind', 'payload'],
};

function mutation(value: unknown): value is AuthorityMutation {
  if (!record(value) || typeof value['kind'] !== 'string') return false;
  const shape = Object.hasOwn(MUTATION_SHAPES, value['kind'])
    ? MUTATION_SHAPES[value['kind']]
    : undefined;
  return shape !== undefined && exact(value, shape) && isValidEnvelope({ from: '', op: value });
}

function manifest(value: unknown): value is AuthorityCheckpointManifest {
  if (
    !exact(
      value,
      [
        'requestId',
        'checkpointId',
        'cursor',
        'encoding',
        'compression',
        'byteLength',
        'chunkBytes',
        'chunkCount',
        'sha256',
        'extensions',
      ],
      ['casToken'],
    )
  )
    return false;
  if (
    !id(value['requestId']) ||
    !id(value['checkpointId']) ||
    !isAuthorityCursor(value['cursor']) ||
    value['encoding'] !== 'base64' ||
    value['compression'] !== 'none' ||
    !integer(value['byteLength'], 1, MAX_AUTHORITY_CHECKPOINT_BYTES) ||
    value['chunkBytes'] !== MAX_AUTHORITY_CHUNK_BYTES ||
    value['chunkCount'] !== Math.ceil(value['byteLength'] / MAX_AUTHORITY_CHUNK_BYTES) ||
    typeof value['sha256'] !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value['sha256']) ||
    (Object.hasOwn(value, 'casToken') && !id(value['casToken'])) ||
    !Array.isArray(value['extensions']) ||
    value['extensions'].length > 256
  )
    return false;
  let previous: string | undefined;
  for (const entry of value['extensions']) {
    if (
      !exact(entry, ['key', 'pluginName', 'version']) ||
      !id(entry['key']) ||
      !id(entry['pluginName']) ||
      !integer(entry['version'], 1) ||
      (previous !== undefined && previous >= entry['key'])
    )
      return false;
    previous = entry['key'];
  }
  return true;
}

function canonicalChunk(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    value.length > Math.ceil(MAX_AUTHORITY_CHUNK_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const size = (value.length / 4) * 3 - padding;
  if (size < 1 || size > MAX_AUTHORITY_CHUNK_BYTES) return false;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const final = alphabet.indexOf(value[value.length - padding - 1] ?? '');
  return final >= 0 && (padding === 0 || (final & (padding === 2 ? 15 : 3)) === 0);
}

function clientFrame(value: unknown): value is AuthorityClientFrame {
  if (!record(value) || value['protocol'] !== 'authority:1') return false;
  switch (value['kind']) {
    case 'propose':
      return (
        exact(
          value,
          ['protocol', 'kind', 'generation', 'clientOperationId', 'mutation'],
          ['expectedState'],
        ) &&
        id(value['generation']) &&
        id(value['clientOperationId']) &&
        mutation(value['mutation']) &&
        (!Object.hasOwn(value, 'expectedState') || id(value['expectedState'])) &&
        (value['mutation'].kind !== 'clear' || id(value['expectedState']))
      );
    case 'checkpoint-request':
      return (
        exact(value, ['protocol', 'kind', 'requestId', 'generation'], ['cursor']) &&
        id(value['requestId']) &&
        id(value['generation']) &&
        (!Object.hasOwn(value, 'cursor') ||
          (isAuthorityCursor(value['cursor']) &&
            value['cursor'].generation === value['generation']))
      );
    default:
      return false;
  }
}

function serverFrame(value: unknown): value is AuthorityServerFrame {
  if (!record(value) || value['protocol'] !== 'authority:1') return false;
  switch (value['kind']) {
    case 'receipt':
      return exact(value, ['protocol', 'kind', 'receipt']) && receipt(value['receipt']);
    case 'rejected':
      return (
        exact(value, ['protocol', 'kind', 'generation', 'clientOperationId', 'reason']) &&
        id(value['generation']) &&
        id(value['clientOperationId']) &&
        [
          'forbidden',
          'invalid',
          'generation-mismatch',
          'conflict',
          'expired',
          'overloaded',
          'unsupported-extension',
          'operation-id-reused',
          'retry-window-expired',
        ].includes(value['reason'] as string)
      );
    case 'changes':
      return (
        exact(value, ['protocol', 'kind', 'cursor', 'mutations']) &&
        isAuthorityCursor(value['cursor']) &&
        Array.isArray(value['mutations']) &&
        value['mutations'].length >= 1 &&
        value['mutations'].length <= 1024 &&
        value['mutations'].every(mutation)
      );
    case 'checkpoint-begin':
      return exact(value, ['protocol', 'kind', 'manifest']) && manifest(value['manifest']);
    case 'checkpoint-chunk':
      return (
        exact(value, ['protocol', 'kind', 'checkpointId', 'index', 'data']) &&
        id(value['checkpointId']) &&
        integer(value['index'], 0, 39) &&
        canonicalChunk(value['data'])
      );
    case 'checkpoint-end':
      return exact(value, ['protocol', 'kind', 'checkpointId']) && id(value['checkpointId']);
    case 'resync-required':
      return (
        exact(value, ['protocol', 'kind', 'generation', 'reason']) &&
        id(value['generation']) &&
        ['delivery-failed', 'gap', 'stream-reset', 'checkpoint-required'].includes(
          value['reason'] as string,
        )
      );
    case 'upgrade-required':
      return exact(value, ['protocol', 'kind', 'required']) && value['required'] === 'authority:1';
    default:
      return false;
  }
}

function parse(message: string, direction: 'client' | 'server' | 'either'): AuthorityFrame | null {
  const value = parseBoundedJson(message, FRAME_LIMITS);
  const valid =
    direction === 'client'
      ? clientFrame(value)
      : direction === 'server'
        ? serverFrame(value)
        : clientFrame(value) || serverFrame(value);
  if (!valid) return null;
  freezeJson(value);
  return value as AuthorityFrame;
}

export function parseAuthorityFrame(message: string): AuthorityFrame | null {
  return parse(message, 'either');
}
export function parseAuthorityClientFrame(message: string): AuthorityClientFrame | null {
  return parse(message, 'client') as AuthorityClientFrame | null;
}
export function parseAuthorityServerFrame(message: string): AuthorityServerFrame | null {
  return parse(message, 'server') as AuthorityServerFrame | null;
}

export function serializeAuthorityFrame(frame: AuthorityFrame): string {
  const encoded = serializeBoundedJson(frame, FRAME_LIMITS);
  if (parseAuthorityFrame(encoded) === null) throw new TypeError('Invalid authority frame');
  return encoded;
}
