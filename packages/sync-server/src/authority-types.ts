import type {
  AuthorityCheckpointPayload,
  AuthorityCheckpointRequirement,
  AuthorityMutation,
  AuthorityReceipt,
  AuthorityRejectionReason,
  LayerRecord,
  SyncElement,
} from '@fieldnotes/sync';
import type {
  AuthorityProposalActor,
  AuthorityProposalContext,
  AuthorityProposalFrame,
} from './authority-proposal';
import type { Connection } from './sync-hub';

type ReadonlyDeep<T> = T extends readonly (infer U)[]
  ? readonly ReadonlyDeep<U>[]
  : T extends object
    ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> }
    : T;
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type AuthorityState = Omit<AuthorityCheckpointPayload, 'cursor' | 'casToken'>;
export interface AuthorityPosition {
  readonly generation: string;
  readonly revision: string;
}
export interface AuthorityReadOptions {
  readonly deadlineAt: number;
  readonly signal: AbortSignal;
}
export interface AuthorityIdentity {
  readonly actorId: string;
  readonly ownershipId: string;
}
export interface AuthorityReadContext extends AuthorityProposalActor {
  readonly ownershipId: string;
  readonly definitionId: string;
}
export interface AuthorityCommitContext extends AuthorityProposalContext {
  readonly ownershipId: string;
  readonly definitionId: string;
}
export type AuthorityIntent =
  | {
      readonly schema: 1;
      readonly kind: 'element-upsert';
      readonly element: ReadonlyDeep<Omit<SyncElement, 'ownerId'>>;
    }
  | { readonly schema: 1; readonly kind: 'element-remove'; readonly id: string }
  | { readonly schema: 1; readonly kind: 'elements-clear' }
  | { readonly schema: 1; readonly kind: 'layer-write'; readonly record: ReadonlyDeep<LayerRecord> }
  | {
      readonly schema: 1;
      readonly kind: 'extension';
      readonly key: string;
      readonly version: number;
      readonly payload: JsonValue;
    };
export interface AuthorityCommitRequest {
  readonly proposal: AuthorityProposalFrame;
  readonly intent: AuthorityIntent;
}
export type AuthorityCommitResult =
  | {
      readonly status: 'committed';
      readonly receipt: AuthorityReceipt;
      readonly position: AuthorityPosition;
      readonly replayed: boolean;
    }
  | { readonly status: 'rejected'; readonly reason: AuthorityRejectionReason };
export interface AuthorityEvidenceRef {
  readonly id: string;
  readonly byteLength: number;
  readonly nodes: number;
}
export interface AuthorityPublication {
  readonly previous: AuthorityPosition;
  readonly position: AuthorityPosition;
  readonly before: AuthorityEvidenceRef;
  readonly after: AuthorityEvidenceRef;
}
export type AuthorityReadPage =
  | {
      readonly status: 'ok';
      readonly head: AuthorityPosition;
      readonly records: readonly AuthorityPublication[];
    }
  | { readonly status: 'gap'; readonly head: AuthorityPosition };
export interface AuthorityEvidenceLease {
  readonly before: AuthorityState;
  readonly after: AuthorityState;
  readonly expiresAt: number;
  readonly token: string;
  release(): Promise<void>;
}
export type AuthorityEvidenceResult =
  | { readonly status: 'available'; readonly lease: AuthorityEvidenceLease }
  | { readonly status: 'history-unavailable' }
  | { readonly status: 'forbidden' }
  | { readonly status: 'generation-changed'; readonly head: AuthorityPosition };
export interface AuthorityCaptureLease {
  readonly position: AuthorityPosition;
  readonly state: AuthorityState;
  readonly casToken?: string;
  readonly expiresAt: number;
  readonly token: string;
  release(): Promise<void>;
}
export interface AuthorityPublicationClaim {
  readonly room: string;
  readonly definitionId: string;
  readonly position: AuthorityPosition;
  readonly ownerId: string;
  readonly token: string;
  readonly expiresAt: number;
}
export interface AuthorityDriver {
  head(context: AuthorityReadContext, options: AuthorityReadOptions): Promise<AuthorityPosition>;
  commit(
    context: AuthorityCommitContext,
    request: AuthorityCommitRequest,
  ): Promise<AuthorityCommitResult>;
  checkpoint(
    context: AuthorityReadContext,
    options: AuthorityReadOptions,
  ): Promise<AuthorityCaptureLease>;
  readAfter(
    context: AuthorityReadContext,
    after: AuthorityPosition,
    limits: { readonly entries: number; readonly bytes: number },
    options: AuthorityReadOptions,
  ): Promise<AuthorityReadPage>;
  readEvidence(
    context: AuthorityReadContext,
    publication: AuthorityPublication,
    options: AuthorityReadOptions,
  ): Promise<AuthorityEvidenceResult>;
  claimPublications(
    ownerId: string,
    limits: { readonly entries: number; readonly bytes: number; readonly leaseMs: number },
    options: AuthorityReadOptions,
  ): Promise<readonly AuthorityPublicationClaim[]>;
  markPublished(claim: AuthorityPublicationClaim, options: AuthorityReadOptions): Promise<void>;
}
export interface AuthorityExtension {
  readonly requirement: AuthorityCheckpointRequirement;
  readonly extensionKinds: readonly string[];
  prepare(mutation: AuthorityMutation): JsonValue | null;
  changes(before: unknown, after: unknown): readonly AuthorityMutation[];
}
export interface AuthorityRoomDefinition {
  readonly id: string;
  readonly extensions: readonly AuthorityExtension[];
  project(context: AuthorityReadContext, state: AuthorityState): AuthorityState;
  canReadOwnerId(context: AuthorityReadContext): boolean;
}
export interface AuthorityOptions {
  readonly driver: AuthorityDriver;
  resolveRoom(room: string): AuthorityRoomDefinition | null;
  resolveIdentity(
    connection: Readonly<
      Pick<Connection, 'id' | 'room' | 'userId' | 'role' | 'authContext' | 'expiresAt'>
    >,
  ): AuthorityIdentity;
}
