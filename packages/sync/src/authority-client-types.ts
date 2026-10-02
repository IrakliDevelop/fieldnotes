import type { AuthorityCheckpointPayload } from './authority-checkpoint';
import type {
  AuthorityClientFrame,
  AuthorityReceipt,
  AuthorityRejectionReason,
} from './authority-protocol';

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
