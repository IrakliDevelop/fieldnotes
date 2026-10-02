import type { AuthorityCheckpointPayload } from './authority-checkpoint';
import type {
  AuthorityClientFrame,
  AuthorityMutation,
  AuthorityReceipt,
  AuthorityRejectionReason,
} from './authority-protocol';
import type { AuthorityClientExtension } from './authority-client-extension';
import type { ManagedSyncEndpoint } from './managed-connection';

export type AuthorityReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly AuthorityReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: AuthorityReadonly<T[K]> }
      : T;

export type AuthorityClientStatus =
  | 'connecting'
  | 'recovering'
  | 'live'
  | 'offline'
  | 'denied'
  | 'upgrade-required'
  | 'stopped';

export interface AuthorityClientOperation {
  readonly clientOperationId: string;
  readonly generation: string;
  readonly localSequence: number;
  readonly localEditGeneration: number;
  readonly proposal: AuthorityReadonly<Extract<AuthorityClientFrame, { kind: 'propose' }>>;
  readonly originalWire: string;
  readonly attempts: number;
  readonly status: 'draft' | 'pending' | 'accepted' | 'rejected' | 'uncertain';
  readonly receipt?: AuthorityReceipt;
  readonly rejection?: AuthorityRejectionReason;
  readonly wasUncertain: boolean;
}

export interface AuthorityClientState {
  readonly status: AuthorityClientStatus;
  readonly scopeId: string;
  readonly generation: string | null;
  readonly document: AuthorityReadonly<AuthorityCheckpointPayload> | null;
  readonly operations: readonly AuthorityClientOperation[];
  readonly localSequence: number;
  readonly localEditGeneration: number;
  readonly error: string | null;
}

export type AuthoritySubmitResult =
  | { readonly status: 'admitted'; readonly clientOperationId: string }
  | {
      readonly status: 'refused';
      readonly reason: 'not-ready' | 'stopped' | 'capacity' | 'invalid';
    };

export type AuthorityRetryResult =
  | { readonly status: 'sent' }
  | {
      readonly status: 'refused';
      readonly reason:
        | 'not-live'
        | 'unknown'
        | 'generation-mismatch'
        | 'accepted'
        | 'pending'
        | 'rejected'
        | 'transport';
    };

export interface AuthorityBarrier {
  readonly barrierId: string;
  readonly scopeId: string;
  readonly generation: string | null;
  readonly throughLocalSequence: number;
  readonly localEditGeneration: number;
  readonly operationIds: readonly string[];
}

export interface AuthorityBarrierResult {
  readonly status:
    | 'acknowledged'
    | 'blocked'
    | 'timeout'
    | 'aborted'
    | 'stopped'
    | 'invalid'
    | 'capacity';
  readonly barrier: AuthorityBarrier;
  readonly accepted: readonly AuthorityReceipt[];
  readonly rejectedIds: readonly string[];
  readonly uncertainIds: readonly string[];
  readonly outstandingIds: readonly string[];
}

export type AuthorityClientCheckpointResult =
  | {
      readonly status: 'complete';
      readonly checkpoint: AuthorityReadonly<AuthorityCheckpointPayload>;
      readonly barrier: AuthorityBarrier | null;
    }
  | {
      readonly status: 'failed';
      readonly reason:
        | 'barrier'
        | 'invalid'
        | 'timeout'
        | 'aborted'
        | 'stopped'
        | 'denied'
        | 'upgrade-required'
        | 'capacity'
        | 'recovery'
        | 'crypto';
    };

export interface AuthorityClientTransportHandlers {
  onOpen(): void;
  onMessage(raw: string): void;
  onClose(code: number, reason: string): void;
}

export interface AuthorityClientTransport {
  start(handlers: AuthorityClientTransportHandlers): void;
  trySend(raw: string): boolean;
  close(): void;
}

export interface ManagedAuthorityOptions {
  readonly scopeId: string;
  readonly clientId: string;
  readonly resolveUrl: () => ManagedSyncEndpoint | null | Promise<ManagedSyncEndpoint | null>;
  readonly extensions?: readonly AuthorityClientExtension[];
  readonly transportFactory?: (endpoint: ManagedSyncEndpoint) => AuthorityClientTransport;
}

export interface ManagedAuthorityConnection {
  getState(): AuthorityClientState;
  subscribe(listener: () => void): () => void;
  stop(): void;
  submit(
    mutation: AuthorityMutation,
    options?: { readonly expectedState?: string },
  ): AuthoritySubmitResult;
  retryOperation(clientOperationId: string): AuthorityRetryResult;
  releaseOperation(
    clientOperationId: string,
    options?: { readonly discardDraft?: boolean },
  ): boolean;
  captureBarrier(): AuthorityBarrier | null;
  releaseBarrier(barrier: AuthorityBarrier): boolean;
  waitForAcknowledgements(
    barrier: AuthorityBarrier,
    options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number },
  ): Promise<AuthorityBarrierResult>;
  requestCheckpoint(options?: {
    readonly barrier?: AuthorityBarrier;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  }): Promise<AuthorityClientCheckpointResult>;
}
