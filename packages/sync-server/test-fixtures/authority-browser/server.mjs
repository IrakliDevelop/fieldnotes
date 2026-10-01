import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSyncServer, prepareAuthorityProposal } from '../../dist/index.js';
import {
  AuthorityCheckpointAssembler,
  createAuthorityCapabilities,
  createAuthorityOperationId,
  serializeAuthorityFrame,
} from '@fieldnotes/sync';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '../..');
const output = resolve(packageRoot, 'dist/authority-browser');
const origin = 'http://sdk-d2b.localhost:4178';
const port = 4178;
const room = 'fixture-table';
const generation = 'fixture-generation';
const definitionId = 'fixture-definition';
const events = [];
const record = (kind, detail = {}) => {
  events.push({ at: new Date().toISOString(), kind, ...detail });
  if (events.length > 80) events.shift();
};

async function build() {
  const { build: tsup } = await import('tsup');
  await tsup({
    entry: [resolve(here, 'client.ts')],
    outDir: output,
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    bundle: true,
    splitting: false,
    noExternal: ['@fieldnotes/core', '@fieldnotes/sync'],
    config: false,
    silent: true,
  });
  await tsup({
    entry: [resolve(packageRoot, 'src/test-support/authority-driver.ts')],
    outDir: output,
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    bundle: true,
    splitting: false,
    external: ['@fieldnotes/sync'],
    config: false,
    silent: true,
  });
  console.log(`Fixture bundles built in ${output}`);
}

if (process.argv.includes('--build')) {
  await build();
  process.exit(0);
}

if (process.argv.includes('--smoke')) await build();
const { AuthorityFixtureStore, AuthorityFixtureDriver } = await import(
  pathToFileURL(resolve(output, 'authority-driver.js')).href
);
const store = new AuthorityFixtureStore();
store.now = Date.now();
store.provision(room, generation, definitionId);
const baseDriver = new AuthorityFixtureDriver(store);
const extension = {
  requirement: {
    key: 'synthetic',
    pluginName: 'authority-browser-fixture',
    version: 1,
    validate: (data) => typeof data === 'string',
  },
  extensionKinds: ['synthetic-change'],
  prepare: (mutation) =>
    mutation.kind === 'extension' && mutation.extensionKind === 'synthetic-change'
      ? mutation.payload
      : null,
  changes: (before, after) =>
    before === after
      ? []
      : [{ kind: 'extension', extensionKind: 'synthetic-change', payload: after }],
};
store.policy.extensions = [extension];
store.policy.canUseExtension = () => true;
store.policy.canUseAudience = (context, audience) => audience !== 'dm' || context.role === 'dm';
store.policy.canCaptureCas = (context) => context.role === 'dm';
let revoked = false;
store.policy.canRead = (context) => !revoked || context.role === 'dm';
store.policy.canWrite = (context) => !revoked || context.role === 'dm';
let loseNextResponse = false;
let pausedCommit;
let pausedCheckpoint;
let activeCommit;
let activeCheckpoint;
let stalledFrame;
const pause = (kind) => {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  const value = { promise, release };
  if (kind === 'commit') pausedCommit = value;
  else pausedCheckpoint = value;
  record(`pause-${kind}`);
};
const driver = {
  head: (...args) => baseDriver.head(...args),
  async commit(...args) {
    store.now = Date.now();
    if (pausedCommit) {
      const pending = pausedCommit;
      pausedCommit = undefined;
      activeCommit = pending;
      record('commit-held');
      await pending.promise;
      activeCommit = undefined;
    }
    const result = await baseDriver.commit(...args);
    record('commit-result', {
      status: result.status,
      replayed: result.replayed ?? false,
      operationId: args[1].proposal.clientOperationId,
    });
    if (result.status === 'committed' && loseNextResponse) {
      loseNextResponse = false;
      record('response-lost', { operationId: args[1].proposal.clientOperationId });
      throw new Error('Injected post-durability response loss');
    }
    return result;
  },
  async checkpoint(...args) {
    store.now = Date.now();
    if (pausedCheckpoint) {
      const pending = pausedCheckpoint;
      pausedCheckpoint = undefined;
      activeCheckpoint = pending;
      record('checkpoint-held');
      await pending.promise;
      activeCheckpoint = undefined;
    }
    return baseDriver.checkpoint(...args);
  },
  readAfter: (...args) => baseDriver.readAfter(...args),
  readEvidence: (...args) => baseDriver.readEvidence(...args),
  claimPublications: (...args) => baseDriver.claimPublications(...args),
  markPublished: (...args) => baseDriver.markPublished(...args),
};

const definition = {
  id: definitionId,
  extensions: [extension],
  project: (context, state) => ({
    ...state,
    elements:
      context.role === 'dm'
        ? state.elements
        : state.elements.filter((element) => element.audience !== 'dm'),
  }),
  canReadOwnerId: (context) => context.role === 'dm',
};

async function seed(mutation) {
  store.now = Date.now();
  const proposal = {
    protocol: 'authority:1',
    kind: 'propose',
    generation,
    clientOperationId: createAuthorityOperationId(store.now),
    mutation,
  };
  const prepared = prepareAuthorityProposal(
    {
      room,
      actorId: 'fixture-seed',
      connectionId: 'fixture-seed',
      userId: 'fixture-seed',
      role: 'dm',
      deadlineAt: Date.now() + 5000,
      signal: new AbortController().signal,
    },
    serializeAuthorityFrame(proposal),
  );
  const accepted = prepared.proposal.mutation;
  const intent =
    accepted.kind === 'upsert'
      ? { schema: 1, kind: 'element-upsert', element: accepted.element }
      : { schema: 1, kind: 'extension', key: 'synthetic', version: 1, payload: accepted.payload };
  const result = await baseDriver.commit(
    { ...prepared.context, ownershipId: 'fixture-seed', definitionId, roomGeneration: generation },
    { proposal: prepared.proposal, intent },
  );
  if (result.status !== 'committed') throw new Error(`Fixture seed rejected: ${result.reason}`);
}

await seed({
  kind: 'upsert',
  element: {
    id: 'private-sentinel',
    type: 'shape',
    position: { x: 50, y: 45 },
    zIndex: 0,
    locked: false,
    layerId: 'default',
    shape: 'rectangle',
    size: { w: 90, h: 55 },
    strokeColor: '#912f3c',
    strokeWidth: 2,
    fillColor: '#ed8c9b',
    audience: 'dm',
  },
});
await seed({
  kind: 'extension',
  extensionKind: 'synthetic-change',
  payload: 'fixture extension v1',
});
record('seeded', { privateElement: 'private-sentinel', extension: 'synthetic' });

function reply(response, status, data, type = 'application/json; charset=utf-8') {
  response.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
const http = createServer(async (request, response) => {
  const host = request.headers.host;
  const requestedOrigin = request.headers.origin;
  if (
    host !== 'sdk-d2b.localhost:4178' ||
    (requestedOrigin !== undefined && requestedOrigin !== origin)
  ) {
    reply(response, 403, { error: 'isolated origin required' });
    return;
  }
  const url = new URL(request.url ?? '/', origin);
  if (request.method === 'GET' && url.pathname === '/') {
    reply(
      response,
      200,
      await readFile(resolve(here, 'index.html'), 'utf8'),
      'text/html; charset=utf-8',
    );
  } else if (request.method === 'GET' && url.pathname === '/client.js') {
    reply(
      response,
      200,
      await readFile(resolve(output, 'client.js'), 'utf8'),
      'text/javascript; charset=utf-8',
    );
  } else if (request.method === 'GET' && url.pathname === '/events') {
    reply(response, 200, {
      events,
      room: {
        generation,
        durableElements: store.getRoom(room)?.state.elements.length ?? 0,
        extensionBytes: store.getRoom(room)?.state.extensions.synthetic?.data.length ?? 0,
      },
    });
  } else if (request.method === 'POST' && url.pathname === '/control') {
    if (requestedOrigin !== origin) {
      reply(response, 403, { error: 'same-origin control required' });
      return;
    }
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 1024) {
        reply(response, 413, { error: 'control too large' });
        return;
      }
    }
    let command;
    try {
      command = JSON.parse(body).command;
    } catch {
      /* rejected below */
    }
    if (command === 'lose-response') loseNextResponse = true;
    else if (command === 'pause-commit') pause('commit');
    else if (command === 'pause-checkpoint') pause('checkpoint');
    else if (command === 'revoke-public') revoked = true;
    else if (command === 'restore-public') revoked = false;
    else if (command === 'release-commit') (activeCommit ?? pausedCommit)?.release();
    else if (command === 'release-checkpoint') (activeCheckpoint ?? pausedCheckpoint)?.release();
    else if (command === 'release-stalled') {
      stalledFrame?.();
      stalledFrame = undefined;
    } else if (command === 'near-limit') {
      if (store.getRoom(room)?.state.elements.length > 10) {
        reply(response, 409, { error: 'near-limit state already loaded' });
        return;
      }
      for (let index = 0; index < 19; index++) {
        await seed({
          kind: 'upsert',
          element: {
            id: `large-private-${index}`,
            type: 'note',
            position: { x: 100_000 + index * 300, y: 100_000 },
            zIndex: 0,
            locked: false,
            layerId: 'default',
            size: { w: 200, h: 40 },
            text: 'X'.repeat(940_000),
            backgroundColor: '#ffffff',
            textColor: '#000000',
            audience: 'dm',
          },
        });
        for (
          let wait = 0;
          wait < 100 && store.getRoom(room)?.entries.some((entry) => !entry.published);
          wait++
        )
          await new Promise((resolve) => setTimeout(resolve, 50));
        store.retirePublished(room, 1024);
      }
    } else {
      reply(response, 400, { error: 'unknown control' });
      return;
    }
    record('control', { command });
    reply(response, 200, { ok: true, command });
  } else reply(response, 404, { error: 'not found' });
});

const sdk = createSyncServer({
  server: http,
  authenticate: ({ req }) => {
    if (req.headers.host !== 'sdk-d2b.localhost:4178' || req.headers.origin !== origin) return null;
    const url = new URL(req.url ?? '/', origin);
    const identity = url.searchParams.get('identity');
    if (!['dm', 'public', 'legacy', 'stalled'].includes(identity ?? '')) return null;
    return {
      userId: `fixture-${identity}`,
      role: identity === 'dm' ? 'dm' : 'public',
      authContext: { fixture: identity },
    };
  },
  framePolicy: {
    authorize: async (context) => {
      if (
        context.direction === 'outbound' &&
        context.authContext?.fixture === 'stalled' &&
        context.message.includes('checkpoint-chunk')
      ) {
        await new Promise((resolve) => {
          stalledFrame = resolve;
        });
      }
      return !revoked || context.role === 'dm';
    },
  },
  authority: {
    driver,
    resolveRoom: (name) => (name === room ? definition : null),
    resolveIdentity: (connection) => ({
      actorId: connection.userId,
      ownershipId: connection.userId,
    }),
  },
});
await new Promise((resolve, reject) =>
  http.listen(port, '127.0.0.1', resolve).once('error', reject),
);
console.log(`Authority fixture ready at ${origin} (PID ${process.pid})`);
const shutdown = async () => {
  stalledFrame?.();
  pausedCommit?.release();
  pausedCheckpoint?.release();
  activeCommit?.release();
  activeCheckpoint?.release();
  await sdk.close();
  await new Promise((resolve) => http.close(resolve));
};
process.once('SIGINT', () => void shutdown().then(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().then(() => process.exit(0)));

if (process.argv.includes('--smoke')) {
  const { WebSocket } = await import('ws');
  const sockets = [];
  const assert = (condition, label) => {
    if (!condition) throw new Error(label);
  };
  const waitFor = async (predicate, label, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert(predicate(), label);
  };
  const post = async (command) => {
    const response = await fetch(`${origin}/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ command }),
      signal: AbortSignal.timeout(command === 'near-limit' ? 120_000 : 10_000),
    });
    assert(response.ok, `Control ${command} failed: ${response.status}`);
  };
  const peer = async (identity) => {
    const socket = new WebSocket(
      `ws://sdk-d2b.localhost:${port}/?room=${room}&identity=${identity}`,
      {
        headers: { Origin: origin },
      },
    );
    sockets.push(socket);
    const frames = [];
    let closeCode;
    socket.on('message', (data) => frames.push(String(data)));
    socket.on('close', (code) => {
      closeCode = code;
    });
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    socket.send(
      JSON.stringify({
        from: 'smoke',
        op: {
          kind: 'capabilities',
          capabilities:
            identity === 'legacy'
              ? { protocolVersions: [3] }
              : createAuthorityCapabilities(['synthetic-change'], [extension.requirement]),
        },
      }),
    );
    const result = {
      socket,
      frames,
      get closeCode() {
        return closeCode;
      },
    };
    if (identity !== 'legacy')
      await waitFor(
        () => frames.some((frame) => JSON.parse(frame).kind === 'resync-required'),
        `${identity} did not negotiate`,
      );
    return result;
  };
  let requestNumber = 0;
  const checkpoint = async (client, timeoutMs = 5000) => {
    const requestId = `smoke-${++requestNumber}`;
    const start = client.frames.length;
    client.socket.send(
      JSON.stringify({
        protocol: 'authority:1',
        kind: 'checkpoint-request',
        requestId,
        generation,
      }),
    );
    await waitFor(
      () => client.frames.slice(start).some((frame) => JSON.parse(frame).kind === 'checkpoint-end'),
      `Missing complete checkpoint for ${requestId}`,
      timeoutMs,
    );
    const assembler = new AuthorityCheckpointAssembler({
      requestId,
      generation,
      requiredExtensions: [extension.requirement],
    });
    let complete;
    for (const raw of client.frames.slice(start)) {
      if (!JSON.parse(raw).kind.startsWith('checkpoint-')) continue;
      const result = await assembler.accept(raw);
      if (result.status === 'complete') complete = result.checkpoint;
    }
    assert(complete, `Assembler incomplete for ${requestId}`);
    return complete;
  };
  const shape = (id) => ({
    id,
    type: 'shape',
    position: { x: 5, y: 5 },
    zIndex: 0,
    locked: false,
    layerId: 'default',
    shape: 'rectangle',
    size: { w: 10, h: 10 },
    strokeColor: 'red',
    strokeWidth: 1,
    fillColor: 'blue',
    audience: 'shared',
  });
  const propose = (client, id, mutation) => {
    const frame = {
      protocol: 'authority:1',
      kind: 'propose',
      generation,
      clientOperationId: id,
      mutation,
    };
    client.socket.send(serializeAuthorityFrame(frame));
    return frame;
  };
  try {
    console.log('Smoke: checking filtered peers and complete checkpoints');
    const dm = await peer('dm');
    const publicPeer = await peer('public');
    const dmState = await checkpoint(dm);
    const publicState = await checkpoint(publicPeer);
    assert(
      dmState.elements.some((element) => element.id === 'private-sentinel'),
      'DM sentinel missing',
    );
    assert(
      !publicState.elements.some((element) => element.id === 'private-sentinel'),
      'Public received private sentinel',
    );
    assert(
      publicState.elements.every((element) => !Object.hasOwn(element, 'ownerId')),
      'Public checkpoint contained owner ID',
    );
    assert(dmState.extensions.synthetic?.data === 'fixture extension v1', 'Extension missing');
    const firstId = createAuthorityOperationId();
    propose(dm, firstId, { kind: 'upsert', element: shape('smoke-shape') });
    await waitFor(
      () =>
        dm.frames.some(
          (frame) =>
            JSON.parse(frame).kind === 'receipt' &&
            JSON.parse(frame).receipt.clientOperationId === firstId,
        ),
      'First receipt missing',
    );
    await waitFor(
      () =>
        publicPeer.frames.some(
          (frame) =>
            JSON.parse(frame).kind === 'changes' &&
            JSON.parse(frame).mutations.some((mutation) => mutation.element?.id === 'smoke-shape'),
        ),
      'Public change missing',
    );
    assert(
      publicPeer.frames
        .filter((frame) => JSON.parse(frame).kind === 'changes')
        .every((frame) =>
          JSON.parse(frame).mutations.every(
            (mutation) => !mutation.element || !Object.hasOwn(mutation.element, 'ownerId'),
          ),
        ),
      'Public change contained owner ID',
    );
    console.log('Smoke: DM/public filtered checkpoint, extension, receipt and changes PASS');

    const legacy = await peer('legacy');
    await waitFor(() => legacy.closeCode === 4406, 'Legacy peer was not refused');
    assert(
      legacy.frames.some((frame) => JSON.parse(frame).kind === 'upgrade-required'),
      'Legacy upgrade-required missing',
    );
    console.log('Smoke: incapable peer refusal PASS');

    console.log('Smoke: checking post-durability loss and retry');
    await post('lose-response');
    const lostId = createAuthorityOperationId();
    const lost = propose(dm, lostId, { kind: 'upsert', element: shape('lost-response-shape') });
    await waitFor(
      () => events.some((entry) => entry.kind === 'response-lost' && entry.operationId === lostId),
      'Post-commit loss not injected',
    );
    await waitFor(() => dm.closeCode !== undefined, 'Origin did not close after uncertain outcome');
    const durableCount = store.getRoom(room).state.elements.length;
    const retained = [...store.getRoom(room).dedupe.values()].find(
      (entry) => entry.receipt.clientOperationId === lostId,
    );
    assert(retained, 'Lost response had no durable receipt');
    const recovered = await peer('dm');
    await checkpoint(recovered);
    recovered.socket.send(serializeAuthorityFrame(lost));
    await waitFor(
      () =>
        recovered.frames.some(
          (frame) =>
            JSON.parse(frame).kind === 'receipt' &&
            JSON.parse(frame).receipt.clientOperationId === lostId,
        ),
      'Original-ID retry receipt missing',
    );
    const replay = recovered.frames
      .map((frame) => JSON.parse(frame))
      .find((frame) => frame.kind === 'receipt' && frame.receipt.clientOperationId === lostId);
    assert(
      replay.receipt.receiptId === retained.receipt.receiptId,
      'Retry changed durable receipt',
    );
    assert(store.getRoom(room).state.elements.length === durableCount, 'Retry duplicated mutation');
    console.log('Smoke: post-durability loss and exact-ID retry PASS');

    console.log('Smoke: checking revocation during held commit');
    await post('pause-commit');
    const deniedId = createAuthorityOperationId();
    propose(publicPeer, deniedId, { kind: 'upsert', element: shape('revoked-shape') });
    await waitFor(
      () => events.some((entry) => entry.kind === 'commit-held'),
      'Commit did not pause',
    );
    await post('revoke-public');
    await post('release-commit');
    await waitFor(
      () =>
        events.some((entry) => entry.kind === 'commit-result' && entry.operationId === deniedId),
      'Revoked commit did not settle',
    );
    assert(
      !store.getRoom(room).state.elements.some((element) => element.id === 'revoked-shape'),
      'Revoked commit mutated state',
    );
    await post('restore-public');
    console.log('Smoke: revocation during held commit PASS');

    console.log('Smoke: checking revocation during held checkpoint');
    await post('pause-checkpoint');
    const checkpointPeer = await peer('public');
    checkpointPeer.socket.send(
      JSON.stringify({
        protocol: 'authority:1',
        kind: 'checkpoint-request',
        requestId: 'revoked-checkpoint',
        generation,
      }),
    );
    await waitFor(
      () => events.some((entry) => entry.kind === 'checkpoint-held'),
      'Checkpoint did not pause',
    );
    await post('revoke-public');
    await post('release-checkpoint');
    await waitFor(
      () => checkpointPeer.closeCode !== undefined,
      'Revoked checkpoint peer did not close',
    );
    assert(
      !checkpointPeer.frames.some((frame) => JSON.parse(frame).kind === 'checkpoint-end'),
      'Revoked checkpoint completed',
    );
    await post('restore-public');
    console.log('Smoke: revocation during held checkpoint PASS');

    console.log('Smoke: checking stalled-peer isolation');
    const stalled = await peer('stalled');
    const stalledStart = stalled.frames.length;
    stalled.socket.send(
      JSON.stringify({
        protocol: 'authority:1',
        kind: 'checkpoint-request',
        requestId: 'stalled-request',
        generation,
      }),
    );
    await waitFor(
      () =>
        stalled.frames
          .slice(stalledStart)
          .some((frame) => JSON.parse(frame).kind === 'checkpoint-begin'),
      'Stalled stream did not begin',
    );
    const other = await peer('public');
    await checkpoint(other);
    const progressId = createAuthorityOperationId();
    propose(recovered, progressId, { kind: 'upsert', element: shape('unrelated-progress') });
    await waitFor(
      () =>
        other.frames.some(
          (frame) =>
            JSON.parse(frame).kind === 'changes' &&
            JSON.parse(frame).mutations.some(
              (mutation) => mutation.element?.id === 'unrelated-progress',
            ),
        ),
      'Unrelated peer stalled',
    );
    await post('release-stalled');
    console.log('Smoke: stalled peer and unrelated progress PASS');

    for (const client of [dm, publicPeer, recovered, stalled, other]) client.socket.close();
    console.log('Smoke: loading near-limit synthetic state');
    await post('near-limit');
    const large = await peer('dm');
    const largeState = await checkpoint(large, 10_000);
    assert(JSON.stringify(largeState).length > 17_000_000, 'Near-limit checkpoint too small');
    assert(
      largeState.elements.some((element) => element.id === 'large-private-18'),
      'Near-limit state incomplete',
    );
    console.log('Smoke: near-limit complete paced checkpoint PASS');
    console.log('Fixture build/startup/socket smoke PASS');
  } finally {
    for (const client of sockets) client.close();
    await shutdown();
  }
}
