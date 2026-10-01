import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { prepareAuthorityCheckpoint, serializeAuthorityFrame } from '@fieldnotes/sync';
import type {
  AuthorityCheckpointPayload,
  AuthorityServerFrame,
  SyncElement,
} from '@fieldnotes/sync';
import type * as Core from '@fieldnotes/core';

const fixture = vi.hoisted(() => ({ viewport: undefined as FakeViewport | undefined }));

class FakeStore {
  private elements = new Map<string, SyncElement>();
  private listeners = new Map<string, ((element: SyncElement) => void)[]>();
  getAll() {
    return [...this.elements.values()];
  }
  getById(id: string) {
    return this.elements.get(id);
  }
  on(kind: string, listener: (element: SyncElement) => void) {
    this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), listener]);
  }
  add(element: SyncElement) {
    this.elements.set(element.id, element);
    for (const listener of this.listeners.get('add') ?? []) listener(element);
  }
  update(id: string, element: SyncElement) {
    this.elements.set(id, element);
  }
  remove(id: string) {
    this.elements.delete(id);
  }
  clear() {
    this.elements.clear();
  }
}
class FakeViewport {
  store = new FakeStore();
  toolManager = {
    activeTool: { name: 'select' },
    register: () => undefined,
  };
  setTool(name: string) {
    this.toolManager.activeTool = { name };
  }
}
vi.mock('@fieldnotes/core', async (importOriginal) => {
  const actual = await importOriginal<typeof Core>();
  return {
    ...actual,
    Viewport: function MockViewport() {
      fixture.viewport = new FakeViewport();
      return fixture.viewport;
    },
  };
});

class FakeNode {
  textContent = '';
  value = 'dm';
  dataset: Record<string, string> = {};
  private listeners = new Map<string, (() => void)[]>();
  addEventListener(kind: string, listener: () => void) {
    this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), listener]);
  }
  click() {
    for (const listener of this.listeners.get('click') ?? []) listener();
  }
}
class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  deferClose = false;
  private listeners = new Map<
    string,
    ((event: { data?: string; code?: number; reason?: string }) => void)[]
  >();
  constructor(_address: URL) {
    FakeSocket.instances.push(this);
  }
  addEventListener(
    kind: string,
    listener: (event: { data?: string; code?: number; reason?: string }) => void,
  ) {
    this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), listener]);
  }
  emit(kind: string, event = {}) {
    for (const listener of this.listeners.get(kind) ?? []) listener(event);
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.emit('open');
  }
  message(frame: string) {
    this.emit('message', { data: frame });
  }
  close(code = 1000) {
    this.readyState = 3;
    if (!this.deferClose) this.emit('close', { code, reason: 'fixture' });
  }
  send(frame: string) {
    this.sent.push(frame);
  }
  frames() {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }
}

let nodes: Map<string, FakeNode>;
const node = (id: string) => {
  const found = nodes.get(id);
  if (!found) throw new Error(id);
  return found;
};
const viewport = () => {
  if (!fixture.viewport) throw new Error('viewport unavailable');
  return fixture.viewport;
};
const status = () =>
  JSON.parse(node('status').textContent) as {
    connection: string;
    identity: string;
    pending: string[];
    receipt: string;
    appliedCursor: { streamId: string; revision: number } | null;
    extensionPreview: string;
    ownerIdsInWire: number;
    visibleIds: string[];
    retainedDrafts: Record<string, string[]>;
  };
const tick = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};
const shape = (id: string): SyncElement => ({
  id,
  type: 'shape',
  position: { x: 1, y: 2 },
  zIndex: 0,
  locked: false,
  layerId: 'default',
  shape: 'rectangle',
  size: { w: 10, h: 10 },
  strokeColor: 'red',
  strokeWidth: 1,
  fillColor: 'blue',
});
const checkpointFrames = async (
  socket: FakeSocket,
  elements: SyncElement[] = [],
  streamId = 'stream',
) => {
  node('checkpoint').click();
  const request = socket
    .frames()
    .reverse()
    .find((frame) => frame.kind === 'checkpoint-request');
  if (typeof request?.requestId !== 'string') throw new Error('checkpoint request absent');
  const payload: AuthorityCheckpointPayload = {
    cursor: { generation: 'fixture-generation', streamId, revision: 0 },
    elements,
    layers: [],
    extensions: {
      synthetic: {
        pluginName: 'authority-browser-fixture',
        version: 1,
        data: 'extension-' + streamId,
      },
    },
  };
  const prepared = await prepareAuthorityCheckpoint(payload, {
    requestId: request.requestId,
    checkpointId: 'checkpoint-' + streamId,
    requiredExtensions: [
      {
        key: 'synthetic',
        pluginName: 'authority-browser-fixture',
        version: 1,
        validate: (value): value is string => typeof value === 'string',
      },
    ],
  });
  return [...prepared.frames].map(serializeAuthorityFrame);
};
const checkpoint = async (
  socket: FakeSocket,
  elements: SyncElement[] = [],
  streamId = 'stream',
) => {
  for (const frame of await checkpointFrames(socket, elements, streamId)) socket.message(frame);
  await tick();
};
const server = (socket: FakeSocket, frame: AuthorityServerFrame) =>
  socket.message(serializeAuthorityFrame(frame));
const connect = (identity = 'dm') => {
  node('identity').value = identity;
  node('connect').click();
  const socket = FakeSocket.instances.at(-1);
  if (!socket) throw new Error('socket absent');
  socket.open();
  return socket;
};

beforeEach(async () => {
  vi.resetModules();
  fixture.viewport = undefined;
  FakeSocket.instances = [];
  nodes = new Map(
    [
      'events',
      'status',
      'viewport',
      'identity',
      'connect',
      'checkpoint',
      'create',
      'move',
      'remove',
      'disconnect',
      'reconnect',
      'retry',
      'shapeTool',
      'selectTool',
      'server-events',
    ].map((id) => [id, new FakeNode()]),
  );
  vi.stubGlobal('document', {
    getElementById: (id: string) => nodes.get(id),
    querySelectorAll: () => [],
  });
  vi.stubGlobal('location', { href: 'http://sdk-d2b.localhost:4178/' });
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('setInterval', () => 0);
  await import('./client');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('discards a real C2 completion held across revocation and permits a timely checkpoint', async () => {
  const socket = connect();
  const frames = await checkpointFrames(socket, [shape('private-sentinel')], 'old');
  const original = crypto.subtle.digest.bind(crypto.subtle);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const digestSpy = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => {
    await held;
    return original(...args);
  });
  for (const frame of frames) socket.message(frame);
  await tick();
  expect(digestSpy).toHaveBeenCalled();
  socket.close(4403);
  release();
  await tick();
  expect(status()).toMatchObject({
    connection: 'closed 4403',
    appliedCursor: null,
    visibleIds: [],
    extensionPreview: 'not installed',
  });
  vi.restoreAllMocks();
  const fresh = connect();
  await checkpoint(fresh, [shape('committed')], 'fresh');
  await vi.waitFor(() => expect(status().appliedCursor?.streamId).toBe('fresh'));
  expect(status()).toMatchObject({
    visibleIds: ['committed'],
    appliedCursor: { streamId: 'fresh' },
  });
});

it('keeps a replacement independent of queued old frames and removes DM state before failed public bootstrap', async () => {
  const dm = connect();
  await checkpoint(dm, [{ ...shape('private-sentinel'), ownerId: 'dm-owner' }], 'dm-stream');
  await vi.waitFor(() => expect(status().appliedCursor?.streamId).toBe('dm-stream'));
  expect(status().ownerIdsInWire).toBe(1);
  node('shapeTool').click();
  viewport().store.add(shape('draft'));
  const originalProposal = dm
    .frames()
    .reverse()
    .find((frame) => frame.kind === 'propose');
  expect(originalProposal).toBeDefined();
  server(dm, {
    protocol: 'authority:1',
    kind: 'receipt',
    receipt: {
      generation: 'fixture-generation',
      clientOperationId: 'prior-operation',
      receiptId: 'prior-receipt',
    },
  });
  await vi.waitFor(() => expect(status().receipt).toBe('prior-receipt'));
  const publicSocket = connect('public');
  expect(status()).toMatchObject({
    identity: 'public',
    appliedCursor: null,
    receipt: 'none',
    visibleIds: [],
    extensionPreview: 'not installed',
    ownerIdsInWire: 0,
  });
  server(dm, {
    protocol: 'authority:1',
    kind: 'rejected',
    generation: 'fixture-generation',
    clientOperationId: String(originalProposal?.clientOperationId),
    reason: 'forbidden',
  });
  node('retry').click();
  expect(publicSocket.frames().filter((frame) => frame.kind === 'propose')).toHaveLength(0);
  publicSocket.close(4403);
  expect(status()).toMatchObject({
    visibleIds: [],
    appliedCursor: null,
    extensionPreview: 'not installed',
  });
  expect(status().retainedDrafts.dm).toEqual([originalProposal?.clientOperationId]);
});

it('restores confirmed pixels after local draw and rejection, and applies only remote changes', async () => {
  const socket = connect();
  await checkpoint(socket, [], 'draw-stream');
  await vi.waitFor(() => expect(status().appliedCursor?.streamId).toBe('draw-stream'));
  node('shapeTool').click();
  viewport().store.add(shape('drawn'));
  const proposal = socket
    .frames()
    .reverse()
    .find((frame) => frame.kind === 'propose');
  expect(proposal).toBeDefined();
  expect(status().pending).toEqual([proposal?.clientOperationId]);
  expect(status().visibleIds).toEqual([]);
  server(socket, {
    protocol: 'authority:1',
    kind: 'rejected',
    generation: 'fixture-generation',
    clientOperationId: String(proposal?.clientOperationId),
    reason: 'forbidden',
  });
  await tick();
  expect(status()).toMatchObject({ pending: [], visibleIds: [] });
  server(socket, {
    protocol: 'authority:1',
    kind: 'changes',
    cursor: {
      generation: 'fixture-generation',
      streamId: 'draw-stream',
      revision: 1,
    },
    mutations: [{ kind: 'upsert', element: shape('remote') }],
  });
  await tick();
  expect(status().visibleIds).toEqual(['remote']);
  expect(socket.frames().filter((frame) => frame.kind === 'propose')).toHaveLength(1);
});

it('lets a replacement bootstrap while an old real C2 digest and queued frames remain unresolved', async () => {
  const old = connect();
  const oldFrames = await checkpointFrames(old, [shape('old-only')], 'old-held');
  const original = crypto.subtle.digest.bind(crypto.subtle);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => {
    if (calls++ === 0) await held;
    return original(...args);
  });
  for (const frame of oldFrames) old.message(frame);
  await vi.waitFor(() => expect(spy).toHaveBeenCalled());
  const fresh = connect('public');
  old.message(
    serializeAuthorityFrame({
      protocol: 'authority:1',
      kind: 'changes',
      cursor: {
        generation: 'fixture-generation',
        streamId: 'old-held',
        revision: 1,
      },
      mutations: [{ kind: 'upsert', element: shape('old-change') }],
    }),
  );
  old.message(
    serializeAuthorityFrame({
      protocol: 'authority:1',
      kind: 'rejected',
      generation: 'fixture-generation',
      clientOperationId: 'old-id',
      reason: 'forbidden',
    }),
  );
  old.message(
    serializeAuthorityFrame({
      protocol: 'authority:1',
      kind: 'receipt',
      receipt: {
        generation: 'fixture-generation',
        clientOperationId: 'old-id',
        receiptId: 'old-receipt',
      },
    }),
  );
  await checkpoint(fresh, [shape('public-only')], 'public-new');
  await vi.waitFor(() => expect(status().appliedCursor?.streamId).toBe('public-new'));
  release();
  await tick();
  expect(status()).toMatchObject({
    identity: 'public',
    receipt: 'none',
    visibleIds: ['public-only'],
    appliedCursor: { streamId: 'public-new' },
  });
});

it('keeps an uncertain drawing as an identity-scoped draft and retries its exact original wire', async () => {
  const first = connect();
  await checkpoint(first, [], 'first');
  await vi.waitFor(() => expect(status().appliedCursor?.streamId).toBe('first'));
  node('shapeTool').click();
  viewport().store.add(shape('uncertain'));
  const proposal = first.sent.find((raw) => JSON.parse(raw).kind === 'propose');
  expect(proposal).toBeDefined();
  first.deferClose = true;
  node('disconnect').click();
  expect(status()).toMatchObject({
    connection: 'disconnecting',
    appliedCursor: null,
    visibleIds: [],
    retainedDrafts: { dm: [JSON.parse(proposal ?? '').clientOperationId] },
  });
  first.emit('message', {
    data: serializeAuthorityFrame({
      protocol: 'authority:1',
      kind: 'receipt',
      receipt: {
        generation: 'fixture-generation',
        clientOperationId: JSON.parse(proposal ?? '').clientOperationId,
        receiptId: 'too-late',
      },
    }),
  });
  const second = connect();
  await checkpoint(second, [], 'second');
  await vi.waitFor(() => expect(status().appliedCursor?.streamId).toBe('second'));
  node('retry').click();
  expect(second.sent.find((raw) => JSON.parse(raw).kind === 'propose')).toBe(proposal);
  first.emit('close', { code: 4403, reason: 'late' });
  expect(status().connection).toBe('connected');
});

it('clears local-only drawing on revoked close while retaining its explicit draft', async () => {
  const socket = connect();
  await checkpoint(socket, [], 'revoked');
  await vi.waitFor(() => expect(status().appliedCursor?.streamId).toBe('revoked'));
  node('shapeTool').click();
  viewport().store.add(shape('pending-revocation'));
  const proposal = socket
    .frames()
    .reverse()
    .find((frame) => frame.kind === 'propose');
  socket.close(4403);
  expect(status()).toMatchObject({
    connection: 'closed 4403',
    visibleIds: [],
    appliedCursor: null,
    retainedDrafts: { dm: [proposal?.clientOperationId] },
  });
});

it('records a receipt without applying pixels or advancing cursor until ordered changes arrive', async () => {
  const socket = connect();
  await checkpoint(socket, [], 'receipts');
  await vi.waitFor(() => expect(status().appliedCursor?.streamId).toBe('receipts'));
  node('create').click();
  const proposal = socket
    .frames()
    .reverse()
    .find((frame) => frame.kind === 'propose');
  expect(proposal).toBeDefined();
  server(socket, {
    protocol: 'authority:1',
    kind: 'receipt',
    receipt: {
      generation: 'fixture-generation',
      clientOperationId: String(proposal?.clientOperationId),
      receiptId: 'durable',
    },
  });
  await vi.waitFor(() => expect(status().receipt).toBe('durable'));
  expect(status()).toMatchObject({ pending: [], visibleIds: [], appliedCursor: { revision: 0 } });
  const element = (proposal?.mutation as { element: SyncElement }).element;
  server(socket, {
    protocol: 'authority:1',
    kind: 'changes',
    cursor: {
      generation: 'fixture-generation',
      streamId: 'receipts',
      revision: 1,
    },
    mutations: [{ kind: 'upsert', element }],
  });
  await vi.waitFor(() => expect(status().appliedCursor?.revision).toBe(1));
  expect(status().visibleIds).toEqual([element.id]);
  expect(socket.frames().filter((frame) => frame.kind === 'propose')).toHaveLength(1);
});
