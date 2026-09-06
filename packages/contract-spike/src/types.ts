// ─── Imports from @fieldnotes/core (F1: spike validates against real types) ──
import type { CanvasElement, GridElement, TemplateElement } from '@fieldnotes/core';
export type { BaseElement, Point, Size, Bounds } from '@fieldnotes/core';
import type { BaseElement, Point, Bounds } from '@fieldnotes/core';

// Re-export core types used throughout the spike
export type { CanvasElement, GridElement, TemplateElement } from '@fieldnotes/core';

// ─── Extension element envelope (core-owned, type-erased) ────────────────────

export interface ExtensionElementEnvelope extends BaseElement {
  readonly type: 'extension';
  readonly extensionType: string;
  readonly data: Record<string, unknown>;
}

// ─── CoreElement — in-memory core types (excludes grid/template) ─────────────
// Grid and template are extracted into ExtensionElementEnvelope at runtime.
// The remaining 7 core element types stay as-is.

export type CoreElement = Exclude<CanvasElement, GridElement | TemplateElement>;

// ─── RuntimeElement — in-memory representation ───────────────────────────────
// Extension elements are stored as ExtensionElementEnvelope in memory.
// Grid/template are NOT members — they live inside envelopes.

export type RuntimeElement = CoreElement | ExtensionElementEnvelope;

// ─── Wire element types — versioned (F4) ─────────────────────────────────────
// V3 wire format: real CanvasElement (includes grid/template as distinct types).
// V4 wire format: CanvasElement | ExtensionElementEnvelope (extensions use envelopes).
// migrateV3toV4() converts grid/template elements → ExtensionElementEnvelope.

export type WireElementV3 = CanvasElement;

export type WireElementV4 = CanvasElement | ExtensionElementEnvelope;

export type WireElement = WireElementV3 | WireElementV4;

// ─── WireSyncOp — sync ops carrying wire elements ────────────────────────────
// Supports both v3 (CanvasElement) and v4 (envelope) wire formats.
// Corrections reuse ordinary op kinds (no separate 'correction' kind).

export type WireSyncOp =
  | { kind: 'upsert'; element: WireElement }
  | { kind: 'remove'; id: string }
  | { kind: 'clear' }
  | { kind: 'snapshot'; to: string; elements: WireElement[] }
  | { kind: 'request-snapshot' }
  | { kind: 'presence'; data: unknown }
  | { kind: 'presence-leave' }
  | { kind: 'fog-meta'; record: unknown }
  | { kind: 'fog-patch'; tiles: unknown[] }
  | WireExtensionOp;

// ─── Extension ops ───────────────────────────────────────────────────────────

export interface WireExtensionOp {
  readonly kind: 'extension';
  readonly extensionKind: string;
  readonly payload: unknown;
}

export interface TypedExtensionOp<TPayload> {
  readonly kind: 'extension';
  readonly extensionKind: string;
  readonly payload: TPayload;
}

// ─── OpCodec ─────────────────────────────────────────────────────────────────

export interface OpCodec<TPayload> {
  validate(payload: unknown): payload is TPayload;
}

// ─── ExtensionKind<TPayload> — unified nominal descriptor ────────────────────
// Single descriptor binding codec + legacy translations + kind string.
// Client/server/backend register handlers against THIS descriptor,
// not independent string+codec pairs.

export interface ExtensionKind<TPayload> {
  readonly extensionKind: string;
  readonly codec: OpCodec<TPayload>;
  readonly legacyKinds: string[];
  readonly toLegacyWire?: (payload: TPayload) => unknown;
  readonly fromLegacyWire?: (legacyPayload: unknown) => TPayload;
}

export function createExtensionKind<TPayload>(config: {
  extensionKind: string;
  codec: OpCodec<TPayload>;
  legacyKinds?: string[];
  toLegacyWire?: (payload: TPayload) => unknown;
  fromLegacyWire?: (legacyPayload: unknown) => TPayload;
}): ExtensionKind<TPayload> {
  return {
    extensionKind: config.extensionKind,
    codec: config.codec,
    legacyKinds: config.legacyKinds ?? [],
    toLegacyWire: config.toLegacyWire,
    fromLegacyWire: config.fromLegacyWire,
  };
}

// ─── ServiceKey<T> — genuine invariance ──────────────────────────────────────
// Uses function-property brand (value: T) => T instead of covariant _in/_out.
// Under strict function types, function properties are checked strictly,
// providing genuine invariance.

declare const ServiceKeyBrand: unique symbol;

export interface ServiceKey<T> {
  readonly [ServiceKeyBrand]: true;
  readonly _brand: (value: T) => T;
  readonly name: string;
  readonly id: symbol;
}

export function createServiceKey<T>(name: string): ServiceKey<T> {
  return {
    [ServiceKeyBrand]: true as const,
    _brand: ((value: unknown) => value) as (value: T) => T,
    name,
    id: Symbol(name),
  };
}

// ─── ElementTypeKey<T> — typed registration handle ───────────────────────────
// Function-property methods (not TS method syntax) to avoid bivariance.
// unwrap() validates and throws on mismatch.

export interface ElementTypeKey<T extends BaseElement> {
  readonly type: string;
  readonly matches: (envelope: ExtensionElementEnvelope) => boolean;
  readonly validateData: (data: Record<string, unknown>) => boolean;
  readonly unwrap: (envelope: ExtensionElementEnvelope) => T;
  readonly wrap: (el: T) => ExtensionElementEnvelope;
}

// ─── ElementTypeDefinition<T> ────────────────────────────────────────────────

export interface ElementTypeDefinition<T extends BaseElement> {
  readonly type: string;
  readonly legacyTypes: string[];
  readonly decodeLegacy: (raw: Record<string, unknown>) => T;
  readonly encodeLegacy: (el: T) => Record<string, unknown>;
  readonly validateData: (data: Record<string, unknown>) => boolean;
  readonly unwrap: (envelope: ExtensionElementEnvelope) => T;
  readonly wrap: (el: T) => ExtensionElementEnvelope;
  readonly bounds: (el: T) => Bounds | null;
}

// ─── ElementTypeAdapter — erased, non-generic ────────────────────────────────

export interface ElementTypeAdapter {
  readonly type: string;
  readonly legacyTypes: string[];
  readonly validateEnvelope: (el: ExtensionElementEnvelope) => boolean;
  readonly decodeLegacy: (raw: Record<string, unknown>) => ExtensionElementEnvelope;
  readonly encodeLegacy: (el: ExtensionElementEnvelope) => Record<string, unknown>;
  readonly bounds: (el: ExtensionElementEnvelope) => Bounds | null;
}

// ─── PersistedPluginState — versioned envelope ───────────────────────────────

export interface PersistedPluginState {
  version: number;
  data: unknown;
}

// ─── NotificationController ──────────────────────────────────────────────────

export interface NotificationController {
  resume(): void;
  discard(): void;
}

// ─── Constraint service ──────────────────────────────────────────────────────

export interface ConstraintOptions {
  mode?: string;
  footprint?: { width: number; height: number };
}

export interface ConstraintInfo {
  type: string;
  [key: string]: unknown;
}

export interface PointConstraintService {
  readonly constrainPoint: (point: Point, options?: ConstraintOptions) => Point;
  readonly getConstraintInfo: () => ConstraintInfo | null;
  readonly hasCapability: (capability: string) => boolean;
}

export interface ConstraintServiceAccess {
  readonly isActive: boolean;
  readonly setActive: (active: boolean) => void;
  readonly constrainPoint: (point: Point, options?: ConstraintOptions) => Point;
  readonly getConstraintInfo: () => ConstraintInfo | null;
  readonly hasCapability: (capability: string) => boolean;
}

// ─── Sync capabilities ──────────────────────────────────────────────────────

export interface SyncCapabilities {
  protocolVersion: number;
  extensionKinds: string[];
  elementEnvelope: boolean;
}

// ─── ApplyResult ─────────────────────────────────────────────────────────────

export interface ApplyResult {
  accepted: WireSyncOp | null;
  corrections: WireSyncOp[];
  broadcast?: WireSyncOp[];
  locality?: 'shared' | 'local';
}

// ─── HubBackend — full decorator interface (F3) ──────────────────────────────

export interface HubBackend {
  snapshot(room: string): Promise<WireElement[]>;
  get(room: string, id: string): Promise<WireElement | undefined>;
  apply(room: string, op: WireSyncOp): Promise<ApplyResult>;
  flush?(room: string): Promise<WireElement[]>;
  dispose?(): Promise<void>;
}

// ─── Plugin interfaces ───────────────────────────────────────────────────────

export interface PluginHandle {
  dispose(): void;
  validateState?(data: unknown): void;
  loadState?(data: unknown): void;
  exportState?(): unknown;
  migrateState?(data: unknown, fromVersion: number): unknown;
  readonly stateVersion?: number;
}

// ─── Canvas state — versioned ────────────────────────────────────────────────

export interface CanvasStateV3 {
  version: 3;
  camera: { position: Point; zoom: number };
  elements: WireElementV3[];
  fog?: FogStateV1;
}

export interface CanvasStateV4 {
  version: 4;
  camera: { position: Point; zoom: number };
  elements: WireElementV4[];
  extensions: Record<string, PersistedPluginState>;
}

export type CanvasState = CanvasStateV3 | CanvasStateV4;

// ─── Fog state ───────────────────────────────────────────────────────────────

export interface FogDefinitionV1 {
  readonly version: 1;
  readonly generation: string;
  readonly bounds: Bounds;
  readonly cellSize: number;
  readonly base: 'covered' | 'revealed';
}

export interface FogTileV1 {
  readonly x: number;
  readonly y: number;
  readonly data: string;
}

export interface FogStateV1 {
  readonly definition: FogDefinitionV1;
  readonly tiles: readonly FogTileV1[];
}

// ─── Layered registry types ──────────────────────────────────────────────────

export interface ClientExtensionRegistry {
  register<TPayload>(
    kind: ExtensionKind<TPayload>,
    handler: (op: TypedExtensionOp<TPayload>, meta: { sender: string }) => void,
  ): void;
}

export interface ServerExtensionRegistry {
  register<TPayload>(
    kind: ExtensionKind<TPayload>,
    handler: (op: TypedExtensionOp<TPayload>, ctx: { room: string }) => Promise<ApplyResult>,
  ): void;
}

export interface BackendExtensionRegistry {
  register<TPayload>(
    kind: ExtensionKind<TPayload>,
    handler: (op: TypedExtensionOp<TPayload>, ctx: { room: string }) => Promise<ApplyResult>,
  ): void;
}
