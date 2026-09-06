// ─── Base geometry ───────────────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ─── Base element (shared fields) ────────────────────────────────────────────

export interface BaseElement {
  id: string;
  position: Point;
  zIndex: number;
  locked: boolean;
  layerId: string;
  groupId?: string;
  rotation?: number;
}

// ─── Core element types (7 closed members) ───────────────────────────────────

export interface StrokeElement extends BaseElement {
  type: 'stroke';
  points: (Point & { pressure: number })[];
  color: string;
  width: number;
  opacity: number;
}

export interface NoteElement extends BaseElement {
  type: 'note';
  size: Size;
  text: string;
  backgroundColor: string;
  textColor: string;
}

export interface ArrowElement extends BaseElement {
  type: 'arrow';
  from: Point;
  to: Point;
  bend: number;
  color: string;
  width: number;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  size: Size;
  src: string;
}

export interface TextElement extends BaseElement {
  type: 'text';
  size: Size;
  text: string;
  fontSize: number;
  color: string;
}

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shape: 'rectangle' | 'ellipse' | 'line';
  size: Size;
  strokeColor: string;
  strokeWidth: number;
  fillColor: string;
}

export type CoreElement =
  | StrokeElement
  | NoteElement
  | ArrowElement
  | ImageElement
  | TextElement
  | ShapeElement;

// ─── Extension element envelope (core-owned, type-erased) ────────────────────

export interface ExtensionElementEnvelope extends BaseElement {
  readonly type: 'extension';
  readonly extensionType: string;
  readonly data: Record<string, unknown>;
}

// ─── RuntimeElement — in-memory representation ───────────────────────────────
// Extension elements are stored as ExtensionElementEnvelope in memory.
// Grid/template are NOT members — they live inside envelopes.

export type RuntimeElement = CoreElement | ExtensionElementEnvelope;

// ─── WireElement — wire/persistence representation ───────────────────────────
// On the wire (v3), grid and template have their own type discriminators.
// On the wire (v4), they use the extension envelope.
// WireElement covers BOTH v3 and v4 wire formats.

export interface WireGridElement extends BaseElement {
  type: 'grid';
  gridType: 'square' | 'hex';
  hexOrientation: 'pointy' | 'flat';
  cellSize: number;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
}

export interface WireTemplateElement extends BaseElement {
  type: 'template';
  templateShape: 'circle' | 'cone' | 'line' | 'square' | 'rectangle';
  radius: number;
  angle: number;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
}

export type WireElement =
  | CoreElement
  | WireGridElement
  | WireTemplateElement
  | ExtensionElementEnvelope;

// ─── WireSyncOp — sync ops with WireElement (not RuntimeElement) ─────────────
// Corrections reuse ordinary op kinds (no separate 'correction' kind).

export type WireSyncOp =
  | { kind: 'upsert'; element: WireElement }
  | { kind: 'remove'; id: string }
  | { kind: 'clear' }
  | { kind: 'snapshot'; to: string; elements: WireElement[] }
  | { kind: 'presence'; data: unknown }
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
// not independent string+codec pairs. (Fixes F8.)

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
// Function properties are bivariant in TS method syntax, but a readonly
// property typed as a function IS checked strictly under strict function types.
// (Fixes F7.)

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
// unwrap() validates and throws on mismatch. (Fixes F7.)

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

// ─── HubBackend — full interface ─────────────────────────────────────────────

export interface HubBackend {
  snapshot(room: string): Promise<WireElement[]>;
  get(room: string, id: string): Promise<WireElement | undefined>;
  apply(room: string, op: WireSyncOp): Promise<ApplyResult>;
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

// ─── Canvas state ────────────────────────────────────────────────────────────

export interface CanvasStateV3 {
  version: 3;
  camera: { position: Point; zoom: number };
  elements: WireElement[];
  fog?: FogStateV1;
}

export interface CanvasStateV4 {
  version: 4;
  camera: { position: Point; zoom: number };
  elements: WireElement[];
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
