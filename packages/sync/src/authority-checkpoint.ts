import { freezeJson, parseBoundedJson, serializeBoundedJson } from './authority-json';
import {
  AUTHORITY_CHECKPOINT_TIMEOUT_MS,
  MAX_AUTHORITY_CHECKPOINT_BYTES,
  MAX_AUTHORITY_CHUNK_BYTES,
  MAX_AUTHORITY_JSON_DEPTH,
  MAX_AUTHORITY_JSON_NODES,
  isAuthorityCursor,
  parseAuthorityServerFrame,
  serializeAuthorityFrame,
} from './authority-protocol';
import type {
  AuthorityCheckpointManifest,
  AuthorityCursor,
  AuthorityServerFrame,
} from './authority-protocol';
import { isValidElement, isValidLayerRecord } from './protocol';
import type { LayerRecord, SyncElement } from './protocol';

type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export interface AuthorityCheckpointExtension {
  readonly pluginName: string;
  readonly version: number;
  readonly data: unknown;
}
export interface AuthorityCheckpointPayload {
  readonly cursor: AuthorityCursor;
  readonly casToken?: string;
  readonly elements: readonly DeepReadonly<SyncElement>[];
  readonly layers: readonly DeepReadonly<LayerRecord>[];
  readonly extensions: Readonly<Record<string, AuthorityCheckpointExtension>>;
}
export interface AuthorityCheckpointRequirement {
  readonly key: string;
  readonly pluginName: string;
  readonly version: number;
  readonly validate: (data: unknown) => boolean;
}
export type AuthorityCheckpointFrame = Extract<
  AuthorityServerFrame,
  { kind: 'checkpoint-begin' | 'checkpoint-chunk' | 'checkpoint-end' }
>;
export interface PreparedAuthorityCheckpoint {
  readonly manifest: AuthorityCheckpointManifest;
  readonly frames: IterableIterator<AuthorityCheckpointFrame>;
  dispose(): void;
}
export interface AuthorityCheckpointPrepareOptions {
  readonly requestId: string;
  readonly checkpointId: string;
  readonly requiredExtensions: readonly AuthorityCheckpointRequirement[];
  readonly signal?: AbortSignal;
}
export interface AuthorityCheckpointAssemblerOptions {
  readonly requestId: string;
  readonly generation: string;
  readonly requiredExtensions: readonly AuthorityCheckpointRequirement[];
  readonly signal?: AbortSignal;
}
export type AuthorityCheckpointFailure =
  | 'invalid'
  | 'timeout'
  | 'aborted'
  | 'disposed'
  | 'closed'
  | 'crypto';
export type AuthorityCheckpointResult =
  | { readonly status: 'pending' }
  | { readonly status: 'complete'; readonly checkpoint: AuthorityCheckpointPayload }
  | { readonly status: 'failed'; readonly reason: AuthorityCheckpointFailure };

const PAYLOAD_LIMITS = {
  bytes: MAX_AUTHORITY_CHECKPOINT_BYTES,
  depth: MAX_AUTHORITY_JSON_DEPTH,
  nodes: MAX_AUTHORITY_JSON_NODES,
} as const;
const encoder = new TextEncoder();
const idPattern = /^[\x21-\x7e]{1,128}$/;
const pending: AuthorityCheckpointResult = Object.freeze({ status: 'pending' });

function id(value: unknown): value is string {
  return typeof value === 'string' && idPattern.test(value);
}
function validSignal(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'object' &&
      value !== null &&
      typeof (value as AbortSignal).aborted === 'boolean' &&
      typeof (value as AbortSignal).addEventListener === 'function' &&
      typeof (value as AbortSignal).removeEventListener === 'function')
  );
}
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
function invalid(): never {
  throw new TypeError('Invalid authority checkpoint');
}
function aborted(): never {
  throw new Error('Authority checkpoint aborted');
}
function cryptoError(): never {
  throw new Error('Authority checkpoint crypto failure');
}

function copyRequirements(
  value: readonly AuthorityCheckpointRequirement[],
): readonly AuthorityCheckpointRequirement[] {
  if (!Array.isArray(value) || value.length > 256) return invalid();
  const seen = new Set<string>();
  const result: AuthorityCheckpointRequirement[] = [];
  for (const entry of value) {
    if (
      !record(entry) ||
      !id(entry['key']) ||
      !id(entry['pluginName']) ||
      !Number.isSafeInteger(entry['version']) ||
      (entry['version'] as number) < 1 ||
      typeof entry['validate'] !== 'function' ||
      seen.has(entry['key'])
    )
      return invalid();
    seen.add(entry['key']);
    result.push({
      key: entry['key'],
      pluginName: entry['pluginName'],
      version: entry['version'] as number,
      validate: entry['validate'] as (data: unknown) => boolean,
    });
  }
  return result.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function inventory(
  value: unknown,
): readonly { readonly key: string; readonly pluginName: string; readonly version: number }[] {
  if (!record(value)) return invalid();
  const keys = Object.keys(value);
  if (keys.length > 256) return invalid();
  return keys.sort().map((key) => {
    const entry = value[key];
    if (
      !id(key) ||
      !exact(entry, ['pluginName', 'version', 'data']) ||
      !id(entry['pluginName']) ||
      !Number.isSafeInteger(entry['version']) ||
      (entry['version'] as number) < 1
    )
      return invalid();
    return { key, pluginName: entry['pluginName'], version: entry['version'] as number };
  });
}
function sameInventory(
  a: readonly { readonly key: string; readonly pluginName: string; readonly version: number }[],
  b: readonly { readonly key: string; readonly pluginName: string; readonly version: number }[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (entry, index) =>
        entry.key === b[index]?.key &&
        entry.pluginName === b[index]?.pluginName &&
        entry.version === b[index]?.version,
    )
  );
}
function shape(
  value: unknown,
  required: readonly AuthorityCheckpointRequirement[],
  manifest?: AuthorityCheckpointManifest,
): AuthorityCheckpointPayload {
  if (
    !exact(value, ['cursor', 'elements', 'layers', 'extensions'], ['casToken']) ||
    !isAuthorityCursor(value['cursor']) ||
    (Object.hasOwn(value, 'casToken') && !id(value['casToken'])) ||
    !Array.isArray(value['elements']) ||
    !Array.isArray(value['layers'])
  )
    return invalid();
  const elements = value['elements'] as unknown[];
  const layers = value['layers'] as unknown[];
  const elementIds = new Set<string>();
  const layerIds = new Set<string>();
  for (const element of elements) {
    if (!isValidElement(element) || elementIds.has(element.id)) return invalid();
    elementIds.add(element.id);
  }
  for (const layer of layers) {
    if (!isValidLayerRecord(layer) || layerIds.has(layer.id)) return invalid();
    layerIds.add(layer.id);
  }
  const actual = inventory(value['extensions']);
  if (!sameInventory(actual, required)) return invalid();
  if (manifest) {
    const cursor = value['cursor'];
    const hasCas = Object.hasOwn(value, 'casToken');
    if (
      !sameInventory(actual, manifest.extensions) ||
      cursor.generation !== manifest.cursor.generation ||
      cursor.streamId !== manifest.cursor.streamId ||
      cursor.revision !== manifest.cursor.revision ||
      hasCas !== Object.hasOwn(manifest, 'casToken') ||
      (hasCas && value['casToken'] !== manifest.casToken)
    )
      return invalid();
  }
  return value as unknown as AuthorityCheckpointPayload;
}
function validateExtensions(
  payload: AuthorityCheckpointPayload,
  required: readonly AuthorityCheckpointRequirement[],
): void {
  for (const entry of required) {
    let result: unknown;
    try {
      result = entry.validate(payload.extensions[entry.key]?.data);
    } catch {
      return invalid();
    }
    if (result !== true) {
      // An invalid async predicate may reject later. Observe that rejection without
      // waiting for it or allowing its result to change the immediate decision.
      if (result !== null && (typeof result === 'object' || typeof result === 'function')) {
        try {
          const promise = Promise.resolve(result);
          void Promise.prototype.then.call(promise, undefined, () => undefined);
        } catch {
          // Hostile thenable access still yields only the generic validation error.
        }
      }
      return invalid();
    }
  }
}
function hex(buffer: ArrayBuffer): string {
  let result = '';
  for (const byte of new Uint8Array(buffer)) result += byte.toString(16).padStart(2, '0');
  return result;
}
async function digest(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return cryptoError();
  try {
    return hex(await subtle.digest('SHA-256', bytes as BufferSource));
  } catch {
    return cryptoError();
  }
}
function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let index = 0; index < bytes.length; index += 8192) {
    let binary = '';
    const end = Math.min(index + 8192, bytes.length);
    for (let offset = index; offset < end; offset += 1)
      binary += String.fromCharCode(bytes[offset] ?? 0);
    parts.push(binary);
  }
  return btoa(parts.join(''));
}
function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Return only compact metadata and one byte buffer; canonical text and parsed tree die here. */
function capturePayload(
  payload: AuthorityCheckpointPayload,
  required: readonly AuthorityCheckpointRequirement[],
): {
  readonly bytes: Uint8Array;
  readonly cursor: AuthorityCursor;
  readonly casToken?: string;
  readonly extensions: AuthorityCheckpointManifest['extensions'];
} {
  const canonical = serializeBoundedJson(payload, PAYLOAD_LIMITS);
  const independent = parseBoundedJson(canonical, PAYLOAD_LIMITS);
  const checked = shape(independent, required);
  freezeJson(checked);
  validateExtensions(checked, required);
  return {
    bytes: encoder.encode(canonical),
    cursor: checked.cursor,
    casToken: checked.casToken,
    extensions: inventory(checked.extensions),
  };
}

/** Capture supplied state before the first await; the caller owns coherent capture and send pacing. */
export async function prepareAuthorityCheckpoint(
  payload: AuthorityCheckpointPayload,
  options: AuthorityCheckpointPrepareOptions,
): Promise<PreparedAuthorityCheckpoint> {
  if (
    !record(options) ||
    !id(options['requestId']) ||
    !id(options['checkpointId']) ||
    !validSignal(options['signal'])
  )
    return invalid();
  const requestId = options.requestId;
  const checkpointId = options.checkpointId;
  const signal = options.signal;
  const required = copyRequirements(options.requiredExtensions);
  if (signal?.aborted) return aborted();
  const { bytes, cursor, casToken, extensions } = capturePayload(payload, required);
  if (signal?.aborted) return aborted();
  let sha256: string;
  try {
    sha256 = await digest(bytes);
  } catch {
    if (signal?.aborted) return aborted();
    return cryptoError();
  }
  if (signal?.aborted) return aborted();
  const rawManifest: AuthorityCheckpointManifest = {
    requestId,
    checkpointId,
    cursor,
    encoding: 'base64',
    compression: 'none',
    byteLength: bytes.length,
    chunkBytes: MAX_AUTHORITY_CHUNK_BYTES,
    chunkCount: Math.ceil(bytes.length / MAX_AUTHORITY_CHUNK_BYTES),
    sha256,
    extensions,
    ...(casToken === undefined ? {} : { casToken }),
  };
  const begin = parseAuthorityServerFrame(
    serializeAuthorityFrame({
      protocol: 'authority:1',
      kind: 'checkpoint-begin',
      manifest: rawManifest,
    }),
  );
  if (begin?.kind !== 'checkpoint-begin') return invalid();
  const manifest = begin.manifest;
  let held: Uint8Array | undefined = bytes;
  let position = 0;
  const release = (): void => {
    held = undefined;
    position = manifest.chunkCount + 2;
    signal?.removeEventListener('abort', release);
  };
  signal?.addEventListener('abort', release, { once: true });
  if (signal?.aborted) release();
  const frames: IterableIterator<AuthorityCheckpointFrame> = {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      if (!held) return { done: true, value: undefined };
      if (position === 0) {
        position += 1;
        return { done: false, value: begin };
      }
      if (position <= manifest.chunkCount) {
        const index = position++ - 1;
        const offset = index * MAX_AUTHORITY_CHUNK_BYTES;
        return {
          done: false,
          value: Object.freeze({
            protocol: 'authority:1',
            kind: 'checkpoint-chunk',
            checkpointId: manifest.checkpointId,
            index,
            data: encodeBase64(
              held.subarray(offset, Math.min(offset + MAX_AUTHORITY_CHUNK_BYTES, held.length)),
            ),
          }) as AuthorityCheckpointFrame,
        };
      }
      const end = Object.freeze({
        protocol: 'authority:1',
        kind: 'checkpoint-end',
        checkpointId: manifest.checkpointId,
      }) as AuthorityCheckpointFrame;
      release();
      return { done: false, value: end };
    },
    return() {
      release();
      return { done: true, value: undefined };
    },
  };
  return { manifest, frames, dispose: release };
}

export class AuthorityCheckpointAssembler {
  private readonly requestId: string;
  private readonly generation: string;
  private readonly required: readonly AuthorityCheckpointRequirement[];
  private readonly signal?: AbortSignal;
  private state: 'idle' | 'receiving' | 'verifying' | 'complete' | 'failed' | 'disposed' = 'idle';
  private failure: AuthorityCheckpointFailure = 'invalid';
  private manifest?: AuthorityCheckpointManifest;
  private bytes?: Uint8Array;
  private nextIndex = 0;
  private deadline = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private token = 0;
  private settle?: (result: AuthorityCheckpointResult) => void;
  private readonly onAbort = (): void => {
    this.fail('aborted');
  };

  constructor(options: AuthorityCheckpointAssemblerOptions) {
    if (
      !record(options) ||
      !id(options['requestId']) ||
      !id(options['generation']) ||
      !validSignal(options['signal'])
    )
      throw new TypeError('Invalid authority checkpoint');
    this.requestId = options.requestId;
    this.generation = options.generation;
    this.required = copyRequirements(options.requiredExtensions);
    this.signal = options.signal;
    if (this.signal?.aborted) this.fail('aborted');
    else this.signal?.addEventListener('abort', this.onAbort, { once: true });
  }
  get status(): 'idle' | 'receiving' | 'verifying' | 'complete' | 'failed' | 'disposed' {
    return this.state;
  }
  private cleanup(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.signal?.removeEventListener('abort', this.onAbort);
    this.bytes = undefined;
    this.manifest = undefined;
  }
  private fail(reason: AuthorityCheckpointFailure): AuthorityCheckpointResult {
    if (this.state === 'failed') return { status: 'failed', reason: this.failure };
    if (this.state === 'disposed') return { status: 'failed', reason: 'disposed' };
    this.state = 'failed';
    this.failure = reason;
    this.token += 1;
    this.cleanup();
    const result = { status: 'failed', reason } as const;
    this.settle?.(result);
    this.settle = undefined;
    return result;
  }
  private expired(): boolean {
    return this.state !== 'idle' && performance.now() >= this.deadline;
  }
  async accept(message: string): Promise<AuthorityCheckpointResult> {
    if (this.state === 'disposed') return { status: 'failed', reason: 'disposed' };
    if (this.state === 'failed') return { status: 'failed', reason: this.failure };
    if (this.state === 'complete') return { status: 'failed', reason: 'closed' };
    if (this.expired()) return this.fail('timeout');
    if (this.state === 'verifying') return this.fail('invalid');
    const frame = parseAuthorityServerFrame(message);
    if (!frame) return this.fail('invalid');
    if (this.state === 'idle') {
      if (
        frame.kind !== 'checkpoint-begin' ||
        frame.manifest.requestId !== this.requestId ||
        frame.manifest.cursor.generation !== this.generation ||
        !sameInventory(frame.manifest.extensions, this.required)
      )
        return this.fail('invalid');
      this.manifest = frame.manifest;
      this.bytes = new Uint8Array(frame.manifest.byteLength);
      this.state = 'receiving';
      this.deadline = performance.now() + AUTHORITY_CHECKPOINT_TIMEOUT_MS;
      this.timer = setTimeout(() => {
        this.fail('timeout');
      }, AUTHORITY_CHECKPOINT_TIMEOUT_MS);
      return pending;
    }
    const manifest = this.manifest;
    const bytes = this.bytes;
    if (!manifest || !bytes) return this.fail('invalid');
    if (frame.kind === 'checkpoint-chunk') {
      if (
        frame.checkpointId !== manifest.checkpointId ||
        frame.index !== this.nextIndex ||
        this.nextIndex >= manifest.chunkCount
      )
        return this.fail('invalid');
      let decoded: Uint8Array;
      try {
        decoded = decodeBase64(frame.data);
      } catch {
        return this.fail('invalid');
      }
      const offset = this.nextIndex * MAX_AUTHORITY_CHUNK_BYTES;
      if (decoded.length !== Math.min(MAX_AUTHORITY_CHUNK_BYTES, bytes.length - offset))
        return this.fail('invalid');
      bytes.set(decoded, offset);
      this.nextIndex += 1;
      if (this.expired()) return this.fail('timeout');
      return pending;
    }
    if (
      frame.kind !== 'checkpoint-end' ||
      frame.checkpointId !== manifest.checkpointId ||
      this.nextIndex !== manifest.chunkCount
    )
      return this.fail('invalid');
    this.state = 'verifying';
    const token = ++this.token;
    return new Promise<AuthorityCheckpointResult>((resolve) => {
      this.settle = resolve;
      void this.verify(bytes, manifest, token);
    });
  }
  private async verify(
    bytes: Uint8Array,
    manifest: AuthorityCheckpointManifest,
    token: number,
  ): Promise<void> {
    let hash: string;
    try {
      hash = await digest(bytes);
    } catch {
      this.fail('crypto');
      return;
    }
    if (this.state !== 'verifying' || token !== this.token) return;
    if (this.expired()) {
      this.fail('timeout');
      return;
    }
    if (hash !== manifest.sha256) {
      this.fail('invalid');
      return;
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      const value = parseBoundedJson(text, PAYLOAD_LIMITS);
      if (!value || serializeBoundedJson(value, PAYLOAD_LIMITS) !== text) {
        this.fail('invalid');
        return;
      }
      const checkpoint = shape(value, this.required, manifest);
      freezeJson(checkpoint);
      validateExtensions(checkpoint, this.required);
      if (this.state !== 'verifying' || token !== this.token) return;
      if (this.expired()) {
        this.fail('timeout');
        return;
      }
      this.state = 'complete';
      this.token += 1;
      this.cleanup();
      this.settle?.({ status: 'complete', checkpoint });
      this.settle = undefined;
    } catch {
      this.fail('invalid');
    }
  }
  dispose(): void {
    if (this.state === 'disposed') return;
    this.state = 'disposed';
    this.token += 1;
    this.cleanup();
    this.settle?.({ status: 'failed', reason: 'disposed' });
    this.settle = undefined;
  }
}
