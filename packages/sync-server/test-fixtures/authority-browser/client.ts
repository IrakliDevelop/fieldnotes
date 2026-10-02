import { createShape, SelectTool, ShapeTool, Viewport } from '@fieldnotes/core';
import {
  AuthorityCheckpointAssembler,
  classifyAuthorityCursor,
  createAuthorityCapabilities,
  createAuthorityOperationId,
  parseAuthorityServerFrame,
  parseEnvelope,
  serializeAuthorityFrame,
} from '@fieldnotes/sync';
import type {
  AuthorityClientFrame,
  AuthorityCursor,
  AuthorityMutation,
  SyncElement,
} from '@fieldnotes/sync';

const requirement = {
  key: 'synthetic',
  pluginName: 'authority-browser-fixture',
  version: 1,
  validate: (value: unknown): value is string => typeof value === 'string',
};
const generation = 'fixture-generation';
const room = 'fixture-table';
const byId = (id: string): HTMLElement => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing fixture node: ${id}`);
  return node;
};
const output = byId('events');
const status = byId('status');
const canvas = byId('viewport');
const viewport = new Viewport(canvas, { background: { pattern: 'dots', spacing: 24 } });
viewport.toolManager.register(new SelectTool());
viewport.toolManager.register(new ShapeTool({ fillColor: '#69a9f0', strokeColor: '#27609c' }));
viewport.setTool('select');

type Proposal = Extract<AuthorityClientFrame, { kind: 'propose' }>;
interface Draft {
  readonly frame: Proposal;
  readonly wire: string;
}
interface Episode {
  readonly socket: WebSocket;
  readonly identity: string;
  active: boolean;
  assembler?: AuthorityCheckpointAssembler;
  inbound: Promise<void>;
}
let episode: Episode | undefined;
let cursor: AuthorityCursor | undefined;
let lastReceipt = 'none';
let extension = 'not installed';
let wireOwnerIds = 0;
let connection = 'disconnected';
let identity = 'dm';
let request = 0;
let suppressLocal = false;
const confirmed = new Map<string, SyncElement>();
const drafts = new Map<string, Map<string, Draft>>();
const pending = (): Map<string, Draft> => {
  let selected = drafts.get(identity);
  if (!selected) {
    selected = new Map();
    drafts.set(identity, selected);
  }
  return selected;
};
const lines: string[] = [];

function current(owner: Episode): boolean {
  return episode === owner && owner.active && owner.socket.readyState === WebSocket.OPEN;
}

function restoreConfirmed(): void {
  suppressLocal = true;
  try {
    viewport.store.clear({ origin: 'remote' });
    for (const element of confirmed.values())
      viewport.store.add(structuredClone(element), { origin: 'remote' });
  } finally {
    suppressLocal = false;
  }
}

function clearInstalled(): void {
  confirmed.clear();
  cursor = undefined;
  extension = 'not installed';
  wireOwnerIds = 0;
  lastReceipt = 'none';
  restoreConfirmed();
}

function invalidate(owner: Episode): void {
  owner.active = false;
  owner.assembler?.dispose();
  owner.assembler = undefined;
  if (episode === owner) clearInstalled();
}

function event(kind: string, details = ''): void {
  lines.unshift(`${new Date().toLocaleTimeString()} ${kind}${details ? ` · ${details}` : ''}`);
  if (lines.length > 35) lines.pop();
  output.textContent = lines.join('\n');
  render();
}

function render(): void {
  const elements = viewport.store.getAll();
  status.textContent = JSON.stringify(
    {
      connection,
      identity,
      pending: [...pending().keys()],
      retainedDrafts: Object.fromEntries(
        [...drafts].map(([scope, entries]) => [scope, [...entries.keys()]]),
      ),
      receipt: lastReceipt,
      appliedCursor: cursor ?? null,
      extensionBytes: extension.length,
      extensionPreview: extension.slice(0, 48),
      ownerIdsInWire: wireOwnerIds,
      publicOwnerLeak: identity !== 'dm' && wireOwnerIds > 0,
      visibleIds: elements.map((element) => element.id),
      privateSentinelVisible: elements.some((element) => element.id === 'private-sentinel'),
    },
    null,
    2,
  );
}

function send(frame: AuthorityClientFrame, owner = episode): void {
  if (!owner || !current(owner)) {
    event('queued locally', frame.kind);
    return;
  }
  owner.socket.send(serializeAuthorityFrame(frame));
  event('sent', frame.kind === 'propose' ? frame.clientOperationId : frame.kind);
}

function checkpoint(): void {
  const owner = episode;
  if (!owner || !current(owner) || identity === 'legacy') return;
  request++;
  const requestId = `fixture-request-${request}`;
  owner.assembler?.dispose();
  owner.assembler = new AuthorityCheckpointAssembler({
    requestId,
    generation,
    requiredExtensions: [requirement],
  });
  send(
    {
      protocol: 'authority:1',
      kind: 'checkpoint-request',
      requestId,
      generation,
      ...(cursor ? { cursor } : {}),
    },
    owner,
  );
}

function applyElement(element: unknown): void {
  const visible = structuredClone(element) as SyncElement;
  delete visible.ownerId;
  confirmed.set(visible.id, structuredClone(visible));
  const existing = viewport.store.getById(visible.id);
  if (existing) viewport.store.update(visible.id, visible, { origin: 'remote' });
  else viewport.store.add(visible, { origin: 'remote' });
}

function applyMutation(mutation: AuthorityMutation): void {
  if (mutation.kind === 'upsert') applyElement(mutation.element);
  else if (mutation.kind === 'remove') {
    confirmed.delete(mutation.id);
    viewport.store.remove(mutation.id, { origin: 'remote' });
  } else if (mutation.kind === 'clear') {
    confirmed.clear();
    viewport.store.clear({ origin: 'remote' });
  } else if (
    mutation.kind === 'extension' &&
    mutation.extensionKind === 'synthetic-change' &&
    typeof mutation.payload === 'string'
  )
    extension = mutation.payload;
}

async function receive(owner: Episode, raw: string): Promise<void> {
  if (!current(owner)) return;
  const envelope = parseEnvelope(raw);
  if (envelope?.op.kind === 'capabilities') {
    event('capabilities received');
    return;
  }
  const frame = parseAuthorityServerFrame(raw);
  if (!frame) {
    event('invalid server frame');
    return;
  }
  if (frame.kind === 'resync-required') {
    event('resync-required', frame.reason);
    checkpoint();
    return;
  }
  if (frame.kind.startsWith('checkpoint-')) {
    const activeAssembler = owner.assembler;
    if (!activeAssembler) {
      event('unexpected checkpoint frame', frame.kind);
      return;
    }
    const result = await activeAssembler.accept(raw);
    if (!current(owner) || owner.assembler !== activeAssembler) return;
    event(frame.kind, result.status);
    if (result.status === 'complete') {
      wireOwnerIds = result.checkpoint.elements.filter((element) =>
        Object.hasOwn(element, 'ownerId'),
      ).length;
      suppressLocal = true;
      try {
        confirmed.clear();
        viewport.store.clear({ origin: 'remote' });
        for (const element of result.checkpoint.elements) applyElement(element);
        extension = String(result.checkpoint.extensions.synthetic?.data ?? 'missing');
        cursor = result.checkpoint.cursor;
      } finally {
        suppressLocal = false;
      }
      owner.assembler = undefined;
      event('checkpoint installed', `${cursor.streamId}:${cursor.revision}`);
    }
    return;
  }
  if (frame.kind === 'changes') {
    const classification = cursor
      ? classifyAuthorityCursor(cursor, frame.cursor)
      : 'reset-required';
    if (classification !== 'next') {
      event('changes refused', classification);
      if (classification !== 'duplicate-or-stale') checkpoint();
      return;
    }
    suppressLocal = true;
    wireOwnerIds += frame.mutations.filter(
      (mutation) => mutation.kind === 'upsert' && Object.hasOwn(mutation.element, 'ownerId'),
    ).length;
    try {
      for (const mutation of frame.mutations) applyMutation(mutation);
    } finally {
      suppressLocal = false;
    }
    cursor = frame.cursor;
    event('changes applied', `revision ${cursor.revision}`);
  } else if (frame.kind === 'receipt') {
    lastReceipt = frame.receipt.receiptId;
    pending().delete(frame.receipt.clientOperationId);
    event('durable receipt', frame.receipt.clientOperationId);
  } else if (frame.kind === 'rejected') {
    pending().delete(frame.clientOperationId);
    event('rejected', `${frame.clientOperationId}: ${frame.reason}`);
  } else if (frame.kind === 'upgrade-required') event('upgrade-required');
  render();
}

function connect(): void {
  const previous = episode;
  if (previous) {
    invalidate(previous);
    previous.socket.close();
  }
  clearInstalled();
  identity = (byId('identity') as HTMLSelectElement).value;
  const address = new URL('/?room=' + room + '&identity=' + identity, location.href);
  address.protocol = 'ws:';
  connection = 'connecting';
  render();
  const next = new WebSocket(address);
  const owner: Episode = { socket: next, identity, active: true, inbound: Promise.resolve() };
  episode = owner;
  next.addEventListener('open', () => {
    if (!current(owner)) return;
    connection = 'connected';
    const capabilities =
      owner.identity === 'legacy'
        ? { protocolVersions: [3] }
        : createAuthorityCapabilities(['synthetic-change'], [requirement]);
    next.send(JSON.stringify({ from: 'fixture', op: { kind: 'capabilities', capabilities } }));
    event('connected', owner.identity);
  });
  next.addEventListener('message', (message) => {
    if (!current(owner)) return;
    owner.inbound = owner.inbound
      .then(() => receive(owner, String(message.data)))
      .catch((error: unknown) => {
        if (current(owner)) event('client error', String(error));
      });
  });
  next.addEventListener('close', (close) => {
    if (episode !== owner) return;
    invalidate(owner);
    connection = `closed ${close.code}`;
    event('closed', `${close.code} ${close.reason}`);
  });
  next.addEventListener('error', () => {
    if (episode === owner && owner.active) event('socket error');
  });
}

function propose(mutation: AuthorityMutation): void {
  const owner = episode;
  if (!owner || !current(owner) || !cursor || owner.identity === 'legacy') {
    restoreConfirmed();
    event('proposal unavailable', 'wait for a complete checkpoint');
    return;
  }
  const proposal: Proposal = structuredClone({
    protocol: 'authority:1' as const,
    kind: 'propose' as const,
    generation,
    clientOperationId: createAuthorityOperationId(),
    mutation,
  });
  const wire = serializeAuthorityFrame(proposal);
  pending().set(proposal.clientOperationId, { frame: proposal, wire });
  owner.socket.send(wire);
  event('sent', proposal.clientOperationId);
  render();
}

function retry(): void {
  const owner = episode;
  if (!owner || !current(owner) || !cursor || owner.identity !== identity) return;
  const draft = [...pending().values()].at(-1);
  if (!draft) return;
  owner.socket.send(draft.wire);
  event('sent', draft.frame.clientOperationId);
}

function disconnect(): void {
  const owner = episode;
  if (!owner) return;
  invalidate(owner);
  connection = 'disconnecting';
  render();
  owner.socket.close();
}

function selectedPublic(): SyncElement | undefined {
  return viewport.store.getAll().find((element) => element.id !== 'private-sentinel');
}

function create(): void {
  const shape = createShape({
    position: { x: 180, y: 100 },
    size: { w: 95, h: 60 },
    fillColor: '#69a9f0',
    strokeColor: '#27609c',
  });
  propose({ kind: 'upsert', element: { ...shape, audience: 'shared' } });
}

function move(): void {
  const shape = selectedPublic();
  if (!shape) {
    event('move unavailable', 'create a public shape first');
    return;
  }
  propose({
    kind: 'upsert',
    element: { ...shape, position: { x: shape.position.x + 40, y: shape.position.y + 25 } },
  });
}

function remove(): void {
  const shape = selectedPublic();
  if (!shape) {
    event('delete unavailable', 'create a public shape first');
    return;
  }
  propose({ kind: 'remove', id: shape.id });
}

for (const [id, action] of Object.entries({
  connect,
  checkpoint,
  create,
  move,
  remove,
  disconnect,
  reconnect: connect,
  retry,
  shapeTool: () => viewport.setTool('shape'),
  selectTool: () => viewport.setTool('select'),
}))
  byId(id).addEventListener('click', action);

for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-command]'))) {
  button.addEventListener('click', async () => {
    const command = button.dataset['command'];
    if (!command) return;
    try {
      const response = await fetch('/control', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command }),
      });
      const result: unknown = await response.json();
      event('control', `${command} ${response.status} ${JSON.stringify(result).slice(0, 100)}`);
    } catch (error) {
      event('control error', String(error));
    }
  });
}

viewport.store.on('add', (element, meta) => {
  if (suppressLocal || meta?.origin === 'remote') return;
  if (viewport.toolManager.activeTool?.name === 'shape')
    propose({ kind: 'upsert', element: { ...element, audience: 'shared' } });
  restoreConfirmed();
  render();
});
viewport.store.on('update', (_change, meta) => {
  if (!suppressLocal && meta?.origin !== 'remote') {
    restoreConfirmed();
    render();
  }
});
viewport.store.on('remove', (_element, meta) => {
  if (!suppressLocal && meta?.origin !== 'remote') {
    restoreConfirmed();
    render();
  }
});
viewport.store.on('clear', (_empty, meta) => {
  if (!suppressLocal && meta?.origin !== 'remote') {
    restoreConfirmed();
    render();
  }
});
setInterval(async () => {
  try {
    const response = await fetch('/events');
    const data = (await response.json()) as { events: { at: string; kind: string }[] };
    byId('server-events').textContent = data.events
      .slice(-20)
      .map((entry) => `${entry.at.slice(11, 19)} ${entry.kind}`)
      .join('\n');
  } catch {
    /* server may be stopped */
  }
}, 1000);
render();
