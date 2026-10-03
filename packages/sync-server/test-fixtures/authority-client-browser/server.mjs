import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSyncServer, prepareAuthorityProposal } from '../../dist/index.js';
import {
  createAuthorityClientExtension,
  createAuthorityExtensionReducer,
  createExtensionKind,
  createManagedAuthorityConnection,
  createAuthorityOperationId,
  serializeAuthorityFrame,
} from '@fieldnotes/sync';
import {
  DropControlAcknowledgement,
  FailureControlOwner,
  ResetTransactionLedger,
  createFailureControlledDriver,
  createFailureControlRuntime,
  handleControlCommand,
} from './failure-control.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '../..');
const output = resolve(packageRoot, 'dist/authority-client-browser');
const requestedPort = Number(process.env.AUTHORITY_CLIENT_FIXTURE_PORT ?? 4179);
if (!Number.isSafeInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535)
  throw new RangeError('AUTHORITY_CLIENT_FIXTURE_PORT must be an integer from 1024 to 65535');
const port = requestedPort;
const origin = `http://sdk-e.localhost:${port}`;
const room = 'sdk-e-table';
const definitionId = 'sdk-e-definition';
let generationNumber = 1;
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
  console.log(`Authority client fixture bundles built in ${output}`);
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
store.provision(room, `fixture-g${generationNumber}`, definitionId);
const baseDriver = new AuthorityFixtureDriver(store);
const failureControl = createFailureControlRuntime({
  owner: new FailureControlOwner(),
  ledger: new ResetTransactionLedger(),
  getGeneration: () => store.getRoom(room).generation,
  replaceAndSeed: async () => {
    generationNumber++;
    store.replace(room, `fixture-g${generationNumber}`, definitionId);
    await seedExtension('ready');
    return store.getRoom(room).generation;
  },
});
const requirement = {
  key: 'synthetic',
  pluginName: 'sdk-e-browser-fixture',
  version: 1,
  validate: (data) => typeof data === 'string',
};
const extension = {
  requirement,
  extensionKinds: ['synthetic:set'],
  prepare: (mutation) =>
    mutation.kind === 'extension' && mutation.extensionKind === 'synthetic:set'
      ? mutation.payload
      : null,
  changes: (before, after) =>
    before === after ? [] : [{ kind: 'extension', extensionKind: 'synthetic:set', payload: after }],
};
store.policy.extensions = [extension];
store.policy.canUseExtension = () => true;
const timedBaseDriver = {
  head: (...args) => baseDriver.head(...args),
  commit: (...args) => {
    store.now = Date.now();
    return baseDriver.commit(...args);
  },
  checkpoint: (...args) => {
    store.now = Date.now();
    return baseDriver.checkpoint(...args);
  },
  readAfter: (...args) => baseDriver.readAfter(...args),
  readEvidence: (...args) => baseDriver.readEvidence(...args),
  claimPublications: (...args) => baseDriver.claimPublications(...args),
  markPublished: (...args) => baseDriver.markPublished(...args),
};
const driver = createFailureControlledDriver(timedBaseDriver, failureControl, { record });
const definition = {
  id: definitionId,
  extensions: [extension],
  project: (_context, state) => state,
  canReadOwnerId: () => false,
};

async function seedExtension(value) {
  store.now = Date.now();
  const generation = store.getRoom(room).generation;
  const proposal = {
    protocol: 'authority:1',
    kind: 'propose',
    generation,
    clientOperationId: createAuthorityOperationId(store.now),
    mutation: { kind: 'extension', extensionKind: 'synthetic:set', payload: value },
  };
  const prepared = prepareAuthorityProposal(
    {
      room,
      actorId: 'fixture-seed',
      connectionId: 'fixture-seed',
      userId: 'fixture-seed',
      deadlineAt: Date.now() + 5_000,
      signal: new AbortController().signal,
    },
    serializeAuthorityFrame(proposal),
  );
  const result = await baseDriver.commit(
    {
      ...prepared.context,
      ownershipId: 'fixture-seed',
      definitionId,
      roomGeneration: generation,
    },
    {
      proposal: prepared.proposal,
      intent: {
        schema: 1,
        kind: 'extension',
        key: 'synthetic',
        version: 1,
        payload: value,
      },
    },
  );
  if (result.status !== 'committed') throw new Error(`Extension seed rejected: ${result.reason}`);
}
await seedExtension('ready');

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
  const requestOrigin = request.headers.origin;
  if (host !== `sdk-e.localhost:${port}` || (requestOrigin && requestOrigin !== origin)) {
    reply(response, 403, { error: 'sdk-e.localhost isolated origin required' });
    return;
  }
  const url = new URL(request.url ?? '/', origin);
  if (request.method === 'GET' && url.pathname === '/')
    reply(
      response,
      200,
      await readFile(resolve(here, 'index.html'), 'utf8'),
      'text/html; charset=utf-8',
    );
  else if (request.method === 'GET' && url.pathname === '/client.js')
    reply(
      response,
      200,
      await readFile(resolve(output, 'client.js'), 'utf8'),
      'text/javascript; charset=utf-8',
    );
  else if (request.method === 'GET' && url.pathname === '/events')
    reply(response, 200, {
      events,
      generation: store.getRoom(room)?.generation,
      elements: store.getRoom(room)?.state.elements.length ?? 0,
    });
  else if (request.method === 'POST' && url.pathname === '/control') {
    if (requestOrigin !== origin) {
      reply(response, 403, { error: 'same-origin control required' });
      return;
    }
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 1_024) break;
    }
    let command;
    try {
      command = JSON.parse(body);
    } catch {
      // Rejected below.
    }
    try {
      const result = await handleControlCommand(command, failureControl);
      record('control', { command: command?.command, code: result.code });
      reply(response, result.ok ? 200 : 409, result);
    } catch (error) {
      if (error instanceof DropControlAcknowledgement) {
        response.destroy();
        return;
      }
      throw error;
    }
  } else reply(response, 404, { error: 'not found' });
});

const sdk = createSyncServer({
  server: http,
  authenticate: ({ req }) => {
    if (req.headers.host !== `sdk-e.localhost:${port}` || req.headers.origin !== origin)
      return null;
    const url = new URL(req.url ?? '/', origin);
    const targetEpisodeId = url.searchParams.get('fixtureEpisode');
    return {
      userId: 'fixture-user',
      authContext: {
        synthetic: targetEpisodeId === null ? {} : { targetEpisodeId },
      },
    };
  },
  framePolicy: { authorize: () => true },
  authority: {
    driver,
    resolveRoom: (name) => (name === room ? definition : null),
    resolveIdentity: () => ({ actorId: 'fixture-user', ownershipId: 'fixture-user' }),
  },
});
await new Promise((resolve, reject) =>
  http.listen(port, '127.0.0.1', resolve).once('error', reject),
);
console.log(`Managed authority fixture ready at ${origin} (PID ${process.pid})`);

const shutdown = async () => {
  await sdk.close();
  await new Promise((resolve) => http.close(resolve));
};
process.once('SIGINT', () => void shutdown().then(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().then(() => process.exit(0)));

if (process.argv.includes('--smoke')) {
  const { WebSocket } = await import('ws');
  const kind = createExtensionKind({
    extensionKind: 'synthetic:set',
    codec: { validate: (value) => typeof value === 'string' },
  });
  const reducer = createAuthorityExtensionReducer({ kind, reduce: (_state, value) => value });
  const clientExtension = createAuthorityClientExtension({
    key: 'synthetic',
    pluginName: 'sdk-e-browser-fixture',
    version: 1,
    validate: (value) => typeof value === 'string',
    reducers: [reducer],
  });
  const transports = [];
  const manager = createManagedAuthorityConnection({
    scopeId: 'fixture-user/sdk-e-table',
    clientId: 'fixture-smoke',
    extensions: [clientExtension],
    resolveUrl: () => ({ url: `ws://sdk-e.localhost:${port}/?room=${room}` }),
    transportFactory: (endpoint) => {
      const socket = new WebSocket(endpoint.url, { headers: { Origin: origin } });
      transports.push(socket);
      let handlers;
      return {
        start(value) {
          handlers = value;
          socket.on('open', handlers.onOpen);
          socket.on('message', (data) => handlers.onMessage(String(data)));
          socket.on('close', (code, reason) => handlers.onClose(code, String(reason)));
        },
        trySend(raw) {
          if (socket.readyState !== WebSocket.OPEN) return false;
          socket.send(raw);
          return true;
        },
        close() {
          socket.close();
        },
      };
    },
  });
  const waitFor = async (predicate, label) => {
    const deadline = Date.now() + 5_000;
    while (!predicate() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    if (!predicate()) throw new Error(label);
  };
  try {
    await waitFor(() => manager.getState().status === 'live', 'manager did not become live');
    const submitted = manager.submit({
      kind: 'upsert',
      element: {
        id: 'smoke-shape',
        type: 'shape',
        position: { x: 0, y: 0 },
        zIndex: 0,
        locked: false,
        layerId: 'default',
        shape: 'rectangle',
        size: { w: 10, h: 10 },
        strokeColor: '#111827',
        strokeWidth: 1,
        fillColor: '#38bdf8',
      },
    });
    if (submitted.status !== 'admitted') throw new Error('smoke submit refused');
    await waitFor(
      () => manager.getState().operations[0]?.status === 'accepted',
      'durable receipt missing',
    );
    await waitFor(
      () => manager.getState().document?.elements.some((item) => item.id === 'smoke-shape'),
      'canonical change missing',
    );
    console.log('Managed manager/server fixture smoke PASS');
  } finally {
    manager.stop();
    for (const socket of transports) socket.close();
    await shutdown();
  }
}
