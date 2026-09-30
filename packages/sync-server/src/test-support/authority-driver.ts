import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  isNewerLayerRecord,
  isValidElement,
  isValidLayerRecord,
  serializeAuthorityFrame,
} from '@fieldnotes/sync';
import type {
  AuthorityCheckpointExtension,
  AuthorityReceipt,
  LayerRecord,
  SyncElement,
} from '@fieldnotes/sync';
import type {
  AuthorityCaptureLease,
  AuthorityCommitContext,
  AuthorityCommitRequest,
  AuthorityCommitResult,
  AuthorityDriver,
  AuthorityEvidenceRef,
  AuthorityEvidenceResult,
  AuthorityExtension,
  AuthorityPosition,
  AuthorityPublication,
  AuthorityPublicationClaim,
  AuthorityReadContext,
  AuthorityReadOptions,
  AuthorityReadPage,
  AuthorityState,
} from '../authority-types';

const DAY = 86_400_000;
const PROFILE = /^fn1:([1-9][0-9]{12}):[0-9a-f]{32}$/;
const MAX_DEDUPE = 1024;
const MAX_LAYERS = 4096;
const MAX_OWNERS = 65536;
const MAX_STATE_BYTES = 20_971_520;
const MAX_OWNERS_BYTES = 8 * 1024 * 1024;
const MAX_LAYERS_BYTES = 4 * 1024 * 1024;
const MAX_OUTBOX_BYTES = 8 * 1024 * 1024;

interface Policy {
  canRead?: (context: AuthorityReadContext) => boolean;
  canWrite?: (context: AuthorityCommitContext, request: AuthorityCommitRequest) => boolean;
  canActOnOwner?: (context: AuthorityCommitContext, owner: string) => boolean;
  canUseAudience?: (context: AuthorityCommitContext, audience: string | undefined) => boolean;
  canUseExtension?: (context: AuthorityCommitContext, key: string) => boolean;
  canClear?: (context: AuthorityCommitContext) => boolean;
  canCaptureCas?: (context: AuthorityReadContext) => boolean;
  extensions?: readonly AuthorityExtension[];
}
interface ReceiptRecord {
  digest: string;
  issuedAt: number;
  committedAt: number;
  receipt: AuthorityReceipt;
  position: AuthorityPosition;
}
interface Image {
  ref: AuthorityEvidenceRef;
  state: AuthorityState;
  references: number;
  pins: number;
}
interface Entry {
  publication: AuthorityPublication;
  published: boolean;
  claim?: AuthorityPublicationClaim;
  issuedOrder: number;
}
interface LeasePin {
  room: Room;
  imageIds: readonly string[];
  expiresAt: number;
}
interface Room {
  generation: string;
  definitionId: string;
  position: AuthorityPosition;
  casToken: string;
  state: AuthorityState;
  currentImage: string;
  elements: Map<string, SyncElement>;
  owners: Map<string, string>;
  layers: Map<string, LayerRecord>;
  extensions: Map<string, AuthorityCheckpointExtension>;
  dedupe: Map<string, ReceiptRecord>;
  retiredIssuedAtFloor: number;
  entries: Entry[];
  images: Map<string, Image>;
  positionKey: Buffer;
  sequence: number;
}

function opaque(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}
function stateOf(room: Pick<Room, 'elements' | 'layers' | 'extensions'>): AuthorityState {
  return {
    elements: Array.from(room.elements.values(), (item) => structuredClone(item)).sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
    layers: Array.from(room.layers.values(), (item) => structuredClone(item)).sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
    extensions: Object.fromEntries(
      Array.from(room.extensions, ([key, value]) => [key, structuredClone(value)]),
    ),
  };
}
function sizeOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
function wellFormedString(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function countedTree(value: unknown): number | null {
  let nodes = 0;
  const seen = new Set<object>();
  const visit = (node: unknown, depth: number): boolean => {
    if (++nodes > 1_000_000) return false;
    if (node === null || typeof node === 'boolean') return true;
    if (typeof node === 'number') return Number.isFinite(node);
    if (typeof node === 'string') return wellFormedString(node);
    if (typeof node !== 'object' || depth > 64 || seen.has(node)) return false;
    seen.add(node);
    try {
      if (Array.isArray(node)) {
        if (Object.getPrototypeOf(node) !== Array.prototype) return false;
        const keys = Reflect.ownKeys(node);
        if (keys.length !== node.length + 1) return false;
        for (let index = 0; index < node.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(node, String(index));
          if (!descriptor?.enumerable || !('value' in descriptor)) return false;
          if (!visit(descriptor.value, depth + 1)) return false;
        }
      } else {
        const proto: unknown = Object.getPrototypeOf(node);
        if (proto !== Object.prototype && proto !== null) return false;
        for (const key of Reflect.ownKeys(node)) {
          if (typeof key !== 'string' || !wellFormedString(key) || ++nodes > 1_000_000)
            return false;
          const descriptor = Object.getOwnPropertyDescriptor(node, key);
          if (!descriptor?.enumerable || !('value' in descriptor)) return false;
          if (!visit(descriptor.value, depth + 1)) return false;
        }
      }
      return true;
    } finally {
      seen.delete(node);
    }
  };
  try {
    return visit(value, 1) ? nodes : null;
  } catch {
    return null;
  }
}
function positionDigest(
  name: string,
  room: Room,
  sequence: number,
  publication: Omit<AuthorityPublication, 'position'>,
): string {
  const { previous, before, after } = publication;
  return createHmac('sha256', room.positionKey)
    .update(
      JSON.stringify([
        name,
        room.definitionId,
        room.generation,
        sequence,
        previous.generation,
        previous.revision,
        before.id,
        before.byteLength,
        before.nodes,
        after.id,
        after.byteLength,
        after.nodes,
      ]),
      'utf8',
    )
    .digest('hex');
}
function authenticPublication(
  name: string,
  room: Room,
  publication: AuthorityPublication,
): boolean {
  const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
    });
  try {
    if (
      !exact(publication, ['previous', 'position', 'before', 'after']) ||
      !exact(publication.previous, ['generation', 'revision']) ||
      !exact(publication.position, ['generation', 'revision']) ||
      !exact(publication.before, ['id', 'byteLength', 'nodes']) ||
      !exact(publication.after, ['id', 'byteLength', 'nodes']) ||
      publication.previous.generation !== room.generation ||
      publication.position.generation !== room.generation ||
      typeof publication.previous.revision !== 'string' ||
      publication.previous.revision.length > 128 ||
      typeof publication.position.revision !== 'string' ||
      publication.position.revision.length > 128
    )
      return false;
    for (const ref of [publication.before, publication.after]) {
      if (
        typeof ref.id !== 'string' ||
        !/^[0-9a-f]{32}$/.test(ref.id) ||
        !Number.isSafeInteger(ref.byteLength) ||
        ref.byteLength < 0 ||
        ref.byteLength > MAX_STATE_BYTES ||
        !Number.isSafeInteger(ref.nodes) ||
        ref.nodes < 1 ||
        ref.nodes > 1_000_000
      )
        return false;
    }
    const match = /^p([1-9][0-9]*)\.([0-9a-f]{64})$/.exec(publication.position.revision);
    if (!match) return false;
    const suppliedHex = match[2];
    if (!suppliedHex) return false;
    const sequence = Number(match[1]);
    if (!Number.isSafeInteger(sequence) || sequence > room.sequence) return false;
    const expected = Buffer.from(positionDigest(name, room, sequence, publication), 'hex');
    const supplied = Buffer.from(suppliedHex, 'hex');
    return timingSafeEqual(expected, supplied);
  } catch {
    return false;
  }
}
function checkOptions(options: AuthorityReadOptions, now: number): void {
  if (options.signal.aborted || now >= options.deadlineAt)
    throw new Error('Authority operation expired');
}
function readAllowed(
  context: AuthorityReadContext,
  room: Room,
  policy: Policy,
  now: number,
): boolean {
  return (
    context.definitionId === room.definitionId &&
    (context.expiresAt === undefined || context.expiresAt > now) &&
    (policy.canRead?.(context) ?? true)
  );
}
function releaseImage(room: Room, id: string): void {
  const image = room.images.get(id);
  if (!image) return;
  image.references--;
  if (image.references <= 0 && image.pins === 0) room.images.delete(id);
}
function dedupeKey(context: AuthorityCommitContext): string {
  return JSON.stringify([context.actorId, context.clientOperationId]);
}

/** Shared deterministic backing state; construct another driver with it to simulate a restart. */
export class AuthorityFixtureStore {
  readonly rooms = new Map<string, Room>();
  readonly retiringRooms: { name: string; room: Room }[] = [];
  private readonly usedGenerations = new Map<string, Set<string>>();
  private readonly leases = new Map<string, LeasePin>();
  nextPublicationOrder = 0;
  now = 1_700_000_000_000;
  maxOutboxEntries = 1024;
  maxDedupeEntries = MAX_DEDUPE;
  maxEvidenceBytes = 64 * 1024 * 1024;
  policy: Policy = {};
  failBeforeCommit = false;
  loseCommitResponse = false;
  failMarkPublished = false;
  precommit?: () => void;

  provision(name: string, generation = 'g', definitionId = 'definition'): void {
    if (this.rooms.has(name)) throw new Error('Room exists');
    const used = this.usedGenerations.get(name) ?? new Set<string>();
    if (used.has(generation) || used.size >= 64) throw new Error('Generation unavailable');
    this.collectRetiring();
    if (this.rooms.size + this.retiringRooms.length >= 64) throw new Error('Provisioning capacity');
    const position = { generation, revision: 'initial' };
    const state: AuthorityState = { elements: [], layers: [], extensions: {} };
    const nodes = countedTree(state);
    if (nodes === null) throw new Error('Fixture initial state invariant');
    const ref = { id: opaque(16), byteLength: sizeOf(state), nodes };
    const image: Image = { ref, state, references: 1, pins: 0 };
    this.rooms.set(name, {
      generation,
      definitionId,
      position,
      casToken: opaque(32),
      state,
      currentImage: ref.id,
      elements: new Map(),
      owners: new Map(),
      layers: new Map(),
      extensions: new Map(),
      dedupe: new Map(),
      retiredIssuedAtFloor: 0,
      entries: [],
      images: new Map([[ref.id, image]]),
      positionKey: randomBytes(32),
      sequence: 0,
    });
    used.add(generation);
    this.usedGenerations.set(name, used);
  }

  replace(name: string, generation: string, definitionId = 'definition'): void {
    const previous = this.rooms.get(name);
    if (!previous || previous.generation === generation)
      throw new Error('Invalid generation replacement');
    const used = this.usedGenerations.get(name);
    if (used?.has(generation) || (used?.size ?? 0) >= 64) throw new Error('Generation unavailable');
    this.collectRetiring();
    const needsRetirement =
      previous.entries.some((entry) => !entry.published) ||
      [...this.leases.values()].some((lease) => lease.room === previous);
    if (needsRetirement && this.rooms.size + this.retiringRooms.length >= 64)
      throw new Error('Provisioning capacity');
    this.rooms.delete(name);
    if (needsRetirement) this.retiringRooms.push({ name, room: previous });
    this.provision(name, generation, definitionId);
  }

  collectRetiring(): void {
    for (let index = this.retiringRooms.length - 1; index >= 0; index--) {
      const retired = this.retiringRooms[index];
      if (
        !retired ||
        retired.room.entries.some((entry) => !entry.published) ||
        [...this.leases.values()].some((lease) => lease.room === retired.room)
      )
        continue;
      retired.room.entries.length = 0;
      retired.room.images.clear();
      this.retiringRooms.splice(index, 1);
    }
  }

  getRoom(name: string): Readonly<Room> | undefined {
    return this.rooms.get(name);
  }

  acquireLease(room: Room, imageIds: readonly string[]): { token: string; expiresAt: number } {
    this.expireLeases();
    if (
      this.leases.size >= 128 ||
      [...this.leases.values()].filter((lease) => lease.room === room).length >= 8
    )
      throw new Error('Authority lease capacity');
    const token = opaque(16);
    const expiresAt = this.now + 5000;
    for (const id of imageIds) {
      const image = room.images.get(id);
      if (!image) throw new Error('Fixture image invariant');
      image.pins++;
    }
    this.leases.set(token, { room, imageIds, expiresAt });
    return { token, expiresAt };
  }

  releaseLease(token: string): void {
    const lease = this.leases.get(token);
    if (!lease) return;
    this.leases.delete(token);
    for (const id of lease.imageIds) {
      const image = lease.room.images.get(id);
      if (!image) continue;
      image.pins--;
      if (image.references <= 0 && image.pins === 0) lease.room.images.delete(id);
    }
    this.collectRetiring();
  }

  expireLeases(): void {
    for (const [token, lease] of this.leases)
      if (lease.expiresAt <= this.now) this.releaseLease(token);
  }
  /** Simulates scheduled published-history retirement and reference-counted GC. */
  retirePublished(name: string, count: number): void {
    const room = this.rooms.get(name);
    if (!room) return;
    for (let i = 0; i < count && room.entries[0]?.published; i++) {
      const entry = room.entries.shift();
      if (!entry) break;
      releaseImage(room, entry.publication.before.id);
      releaseImage(room, entry.publication.after.id);
    }
  }
}

export class AuthorityFixtureDriver implements AuthorityDriver {
  constructor(readonly store: AuthorityFixtureStore) {}

  private room(name: string): Room {
    const room = this.store.rooms.get(name);
    if (!room) throw new Error('Authority room unavailable');
    return room;
  }

  async head(
    context: AuthorityReadContext,
    options: AuthorityReadOptions,
  ): Promise<AuthorityPosition> {
    checkOptions(options, this.store.now);
    const room = this.room(context.room);
    if (!readAllowed(context, room, this.store.policy, this.store.now))
      throw new Error('Authority read forbidden');
    return { ...room.position };
  }

  async commit(
    context: AuthorityCommitContext,
    request: AuthorityCommitRequest,
  ): Promise<AuthorityCommitResult> {
    this.store.expireLeases();
    const room = this.store.rooms.get(context.room);
    const reject = (
      reason: Extract<AuthorityCommitResult, { status: 'rejected' }>['reason'],
    ): AuthorityCommitResult => ({ status: 'rejected', reason });
    if (
      !room ||
      context.definitionId !== room.definitionId ||
      context.roomGeneration !== room.generation ||
      request.proposal.generation !== room.generation
    )
      return reject('generation-mismatch');
    if (
      context.signal.aborted ||
      this.store.now >= context.deadlineAt ||
      (context.expiresAt !== undefined && this.store.now >= context.expiresAt)
    )
      return reject('expired');
    if (!readAllowed(context, room, this.store.policy, this.store.now)) return reject('forbidden');
    if (request.proposal.clientOperationId !== context.clientOperationId) return reject('invalid');
    let actualDigest: string;
    try {
      actualDigest = createHash('sha256')
        .update('fieldnotes.authority-proposal.v1\0', 'utf8')
        .update(JSON.stringify([context.room, context.actorId]), 'utf8')
        .update('\0', 'utf8')
        .update(serializeAuthorityFrame(request.proposal), 'utf8')
        .digest('hex');
    } catch {
      return reject('invalid');
    }
    if (actualDigest !== context.operationDigest) return reject('invalid');
    const key = dedupeKey(context);
    const old = room.dedupe.get(key);
    if (old) {
      if (old.digest !== context.operationDigest) return reject('operation-id-reused');
      return { status: 'committed', receipt: old.receipt, position: old.position, replayed: true };
    }
    const match = PROFILE.exec(context.clientOperationId);
    if (!match) return reject('invalid');
    const issuedAt = Number(match[1]);
    if (issuedAt > this.store.now + 60_000) return reject('invalid');
    if (issuedAt < this.store.now - DAY || issuedAt <= room.retiredIssuedAtFloor)
      return reject('retry-window-expired');
    if (
      request.proposal.clientOperationId !== context.clientOperationId ||
      request.proposal.generation !== context.roomGeneration ||
      !(this.store.policy.canWrite?.(context, request) ?? true)
    )
      return reject('forbidden');
    if (
      request.proposal.expectedState !== undefined &&
      request.proposal.expectedState !== room.casToken
    )
      return reject('conflict');
    if (request.intent.kind === 'elements-clear' && request.proposal.expectedState === undefined)
      return reject('conflict');

    const elements = new Map(room.elements);
    const owners = new Map(room.owners);
    const layers = new Map(room.layers);
    const extensions = new Map(room.extensions);
    const mutation = request.proposal.mutation;
    const intent = request.intent;
    if (intent.schema !== 1) return reject('invalid');
    switch (intent.kind) {
      case 'element-upsert': {
        if (
          mutation.kind !== 'upsert' ||
          JSON.stringify(intent.element) !==
            JSON.stringify(
              Object.fromEntries(
                Object.entries(mutation.element).filter(([name]) => name !== 'ownerId'),
              ),
            )
        )
          return reject('invalid');
        if (!isValidElement(intent.element)) return reject('invalid');
        const owner = owners.get(intent.element.id);
        if (
          owner &&
          owner !== context.ownershipId &&
          !(this.store.policy.canActOnOwner?.(context, owner) ?? false)
        )
          return reject('forbidden');
        if (!(this.store.policy.canUseAudience?.(context, intent.element.audience) ?? true))
          return reject('forbidden');
        if (!owner) owners.set(intent.element.id, context.ownershipId);
        elements.set(intent.element.id, {
          ...structuredClone(intent.element),
          ownerId: owners.get(intent.element.id),
        });
        break;
      }
      case 'element-remove': {
        if (mutation.kind !== 'remove' || mutation.id !== intent.id) return reject('invalid');
        if (!elements.has(intent.id)) return reject('conflict');
        const owner = owners.get(intent.id);
        if (
          owner &&
          owner !== context.ownershipId &&
          !(this.store.policy.canActOnOwner?.(context, owner) ?? false)
        )
          return reject('forbidden');
        elements.delete(intent.id);
        break;
      }
      case 'elements-clear':
        if (mutation.kind !== 'clear') return reject('invalid');
        if (!(this.store.policy.canClear?.(context) ?? false)) return reject('forbidden');
        if (elements.size === 0) return reject('conflict');
        elements.clear();
        break;
      case 'layer-write': {
        const expected =
          mutation.kind === 'layer-upsert'
            ? {
                id: mutation.layer.id,
                version: mutation.version,
                editor: mutation.editor,
                definition: mutation.layer,
              }
            : mutation.kind === 'layer-remove'
              ? { id: mutation.id, version: mutation.version, editor: mutation.editor }
              : null;
        if (
          !expected ||
          JSON.stringify(intent.record) !== JSON.stringify(expected) ||
          !isValidLayerRecord(intent.record)
        )
          return reject('invalid');
        const previous = layers.get(intent.record.id);
        if (previous && !isNewerLayerRecord(intent.record, previous)) return reject('conflict');
        layers.set(intent.record.id, structuredClone(intent.record));
        break;
      }
      case 'extension': {
        if (mutation.kind !== 'extension') return reject('invalid');
        const extension = this.store.policy.extensions?.find((item) =>
          item.extensionKinds.includes(mutation.extensionKind),
        );
        if (!extension) return reject('unsupported-extension');
        if (
          intent.key !== extension.requirement.key ||
          intent.version !== extension.requirement.version
        )
          return reject('invalid');
        let expectedPayload: unknown;
        try {
          expectedPayload = extension.prepare(mutation);
        } catch {
          return reject('invalid');
        }
        if (
          expectedPayload === null ||
          countedTree(expectedPayload) === null ||
          countedTree(intent.payload) === null ||
          JSON.stringify(expectedPayload) !== JSON.stringify(intent.payload) ||
          !extension.requirement.validate(intent.payload)
        )
          return reject('invalid');
        if (!(this.store.policy.canUseExtension?.(context, intent.key) ?? false))
          return reject('unsupported-extension');
        extensions.set(intent.key, {
          pluginName: extension.requirement.pluginName,
          version: intent.version,
          data: structuredClone(intent.payload),
        });
        break;
      }
    }
    if (
      owners.size > MAX_OWNERS ||
      layers.size > MAX_LAYERS ||
      sizeOf([...owners]) > MAX_OWNERS_BYTES ||
      sizeOf([...layers]) > MAX_LAYERS_BYTES
    )
      return reject('overloaded');
    const nextState = stateOf({ elements, layers, extensions });
    const nodes = countedTree(nextState);
    if (nodes === null) return reject('overloaded');
    const bytes = sizeOf(nextState);
    const checkpoint = {
      cursor: { generation: room.generation, streamId: '0'.repeat(32), revision: 0 },
      casToken: '0'.repeat(64),
      ...nextState,
    };
    const checkpointNodes = countedTree(checkpoint);
    if (checkpointNodes === null) return reject('overloaded');
    const checkpointBytes = sizeOf(checkpoint);
    if (bytes > MAX_STATE_BYTES || checkpointBytes > MAX_STATE_BYTES) return reject('overloaded');

    const dedupe = new Map(room.dedupe);
    let floor = room.retiredIssuedAtFloor;
    const evict = (evictKey: string, record: ReceiptRecord) => {
      floor = Math.max(floor, record.issuedAt);
      dedupe.delete(evictKey);
    };
    for (const [evictKey, record] of dedupe) {
      if (record.committedAt <= this.store.now - DAY) evict(evictKey, record);
    }
    const ordered = [...dedupe].sort(
      (a, b) => a[1].issuedAt - b[1].issuedAt || a[0].localeCompare(b[0]),
    );
    while (dedupe.size >= this.store.maxDedupeEntries) {
      const victim = ordered.shift();
      if (!victim) break;
      evict(victim[0], victim[1]);
    }
    if (issuedAt <= floor) return reject('retry-window-expired');
    let retireCount = 0;
    let projectedArena = [...room.images.values()].reduce(
      (sum, image) => sum + image.ref.byteLength,
      0,
    );
    const remainingRefs = new Map([...room.images].map(([id, image]) => [id, image.references]));
    while (
      room.entries.length + 1 - retireCount > this.store.maxOutboxEntries ||
      sizeOf(room.entries.slice(retireCount).map((entry) => entry.publication)) >
        MAX_OUTBOX_BYTES ||
      projectedArena + bytes > this.store.maxEvidenceBytes
    ) {
      const candidate = room.entries[retireCount];
      if (!candidate?.published) return reject('overloaded');
      for (const ref of [candidate.publication.before, candidate.publication.after]) {
        const count = (remainingRefs.get(ref.id) ?? 0) - 1;
        remainingRefs.set(ref.id, count);
        const image = room.images.get(ref.id);
        if (count === 0 && image?.pins === 0) projectedArena -= image.ref.byteLength;
      }
      retireCount++;
    }
    this.store.precommit?.();
    if (this.store.failBeforeCommit) throw new Error('Injected transaction failure');
    const previous = room.position;
    const receipt = {
      generation: room.generation,
      clientOperationId: context.clientOperationId,
      receiptId: opaque(16),
    };
    const before = room.images.get(room.currentImage);
    if (!before) throw new Error('Fixture image invariant');
    const after: Image = {
      ref: { id: opaque(16), byteLength: bytes, nodes },
      state: nextState,
      references: 2,
      pins: 0,
    };
    const publicationBody = { previous, before: before.ref, after: after.ref };
    const sequence = room.sequence + 1;
    if (!Number.isSafeInteger(sequence)) return reject('overloaded');
    const position = {
      generation: room.generation,
      revision: `p${sequence}.${positionDigest(context.room, room, sequence, publicationBody)}`,
    };
    before.references++;
    room.elements = elements;
    room.owners = owners;
    room.layers = layers;
    room.extensions = extensions;
    room.state = nextState;
    room.position = position;
    room.sequence++;
    room.casToken = opaque(32);
    room.retiredIssuedAtFloor = floor;
    room.dedupe = dedupe;
    room.dedupe.set(key, {
      digest: context.operationDigest,
      issuedAt,
      committedAt: this.store.now,
      receipt,
      position,
    });
    room.images.set(after.ref.id, after);
    releaseImage(room, room.currentImage);
    room.currentImage = after.ref.id;
    room.entries.push({
      publication: { ...publicationBody, position },
      published: false,
      issuedOrder: ++this.store.nextPublicationOrder,
    });
    this.store.retirePublished(context.room, retireCount);
    if (this.store.loseCommitResponse) throw new Error('Injected lost commit response');
    return { status: 'committed', receipt, position, replayed: false };
  }

  async checkpoint(
    context: AuthorityReadContext,
    options: AuthorityReadOptions,
  ): Promise<AuthorityCaptureLease> {
    checkOptions(options, this.store.now);
    const room = this.room(context.room);
    if (!readAllowed(context, room, this.store.policy, this.store.now))
      throw new Error('Authority read forbidden');
    const image = room.images.get(room.currentImage);
    if (!image) throw new Error('Fixture image invariant');
    const { token, expiresAt } = this.store.acquireLease(room, [image.ref.id]);
    return {
      position: { ...room.position },
      state: structuredClone(room.state),
      ...(this.store.policy.canCaptureCas?.(context) ? { casToken: room.casToken } : {}),
      token,
      expiresAt,
      release: async () => this.store.releaseLease(token),
    };
  }

  async readAfter(
    context: AuthorityReadContext,
    after: AuthorityPosition,
    limits: { readonly entries: number; readonly bytes: number },
    options: AuthorityReadOptions,
  ): Promise<AuthorityReadPage> {
    checkOptions(options, this.store.now);
    const room = this.room(context.room);
    if (!readAllowed(context, room, this.store.policy, this.store.now))
      throw new Error('Authority read forbidden');
    const head = { ...room.position };
    if (after.generation !== room.generation) return { status: 'gap', head };
    if (after.revision === head.revision) return { status: 'ok', head, records: [] };
    const first = room.entries.findIndex(
      (entry) => entry.publication.previous.revision === after.revision,
    );
    if (first < 0) return { status: 'gap', head };
    const records: AuthorityPublication[] = [];
    let bytes = 0;
    for (const entry of room.entries.slice(first)) {
      const cost = sizeOf(entry.publication);
      if (records.length >= limits.entries || bytes + cost > limits.bytes) break;
      records.push(structuredClone(entry.publication));
      bytes += cost;
    }
    return { status: 'ok', head, records };
  }

  async readEvidence(
    context: AuthorityReadContext,
    publication: AuthorityPublication,
    options: AuthorityReadOptions,
  ): Promise<AuthorityEvidenceResult> {
    checkOptions(options, this.store.now);
    this.store.expireLeases();
    const room = this.room(context.room);
    if (!readAllowed(context, room, this.store.policy, this.store.now))
      return { status: 'forbidden' };
    let evidenceGeneration: unknown;
    try {
      evidenceGeneration = publication?.position?.generation;
    } catch {
      throw new Error('Invalid authority evidence reference');
    }
    if (typeof evidenceGeneration !== 'string')
      throw new Error('Invalid authority evidence reference');
    if (evidenceGeneration !== room.generation)
      return { status: 'generation-changed', head: { ...room.position } };
    if (!authenticPublication(context.room, room, publication))
      throw new Error('Invalid authority evidence reference');
    const before = room.images.get(publication.before.id);
    const after = room.images.get(publication.after.id);
    if (!before || !after) return { status: 'history-unavailable' };
    const { token, expiresAt } = this.store.acquireLease(room, [before.ref.id, after.ref.id]);
    return {
      status: 'available',
      lease: {
        before: structuredClone(before.state),
        after: structuredClone(after.state),
        expiresAt,
        token,
        release: async () => this.store.releaseLease(token),
      },
    };
  }

  async claimPublications(
    ownerId: string,
    limits: { readonly entries: number; readonly bytes: number; readonly leaseMs: number },
    options: AuthorityReadOptions,
  ): Promise<readonly AuthorityPublicationClaim[]> {
    checkOptions(options, this.store.now);
    const result: AuthorityPublicationClaim[] = [];
    let bytes = 0;
    const active = [...this.store.rooms].map(([name, room]) => ({ name, room }));
    const candidates = [...active, ...this.store.retiringRooms]
      .flatMap(({ name, room }) => room.entries.map((entry) => ({ name, room, entry })))
      .sort((a, b) => a.entry.issuedOrder - b.entry.issuedOrder);
    for (const { name, room, entry } of candidates) {
      if (entry.published || (entry.claim && entry.claim.expiresAt > this.store.now)) continue;
      const claim = {
        room: name,
        definitionId: room.definitionId,
        position: entry.publication.position,
        ownerId,
        token: opaque(16),
        expiresAt: this.store.now + Math.min(limits.leaseMs, 5000),
      };
      const cost = sizeOf(claim);
      if (result.length >= limits.entries || bytes + cost > limits.bytes) return result;
      entry.claim = claim;
      result.push(claim);
      bytes += cost;
    }
    return result;
  }

  async markPublished(
    claim: AuthorityPublicationClaim,
    options: AuthorityReadOptions,
  ): Promise<void> {
    checkOptions(options, this.store.now);
    if (this.store.failMarkPublished) throw new Error('Injected publish failure');
    const room = [
      this.store.rooms.get(claim.room),
      ...this.store.retiringRooms
        .filter((item) => item.name === claim.room)
        .map((item) => item.room),
    ].find((candidate) => candidate?.generation === claim.position.generation);
    const entry = room?.entries.find(
      (item) => item.publication.position.revision === claim.position.revision,
    );
    if (
      !entry ||
      room?.definitionId !== claim.definitionId ||
      entry.publication.position.generation !== claim.position.generation ||
      !entry.claim ||
      entry.claim.token !== claim.token ||
      entry.claim.ownerId !== claim.ownerId ||
      entry.claim.expiresAt <= this.store.now
    )
      return;
    entry.published = true;
    entry.claim = undefined;
    this.store.collectRetiring();
  }
}
