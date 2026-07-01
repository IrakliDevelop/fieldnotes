# @fieldnotes/sync-server

Authoritative WebSocket relay server for [`@fieldnotes/sync`](../sync).

The relay holds the canonical per-room canvas state and fans out element
operations to every other connection in the room. Clients connect, request a
snapshot to catch up, then stream `upsert` / `remove` / `clear` ops that the hub
applies and forwards.

## Pieces

- **`SyncHub`** — transport-agnostic relay. Per-room canonical state lives behind
  an async `HubBackend`; each room processes messages on its own serial queue so
  concurrent edits to the same room never race, while different rooms run
  independently.
- **`MemoryHubBackend`** — in-memory `HubBackend` (the default). Redis-backed and
  authenticated backends are planned.
- **`createSyncServer`** — a runnable `ws` reference server. Connect with
  `?room=<id>` in the query string; missing room closes the socket.
- **`HubFanout`** — cross-instance live fan-out seam. `SyncHub` publishes each live
  op to the fanout and forwards ops it receives from other instances to its local
  connections. The default `InMemoryHubFanout` is in-process (a no-op for a single
  instance). For multiple relay instances to share live ops, pass a shared fanout
  via `createSyncServer({ fanout })` (e.g. `RedisHubFanout` from
  [`@fieldnotes/sync-redis`](../sync-redis)) **together with a shared backend** — a
  shared fanout alone leaves a new joiner's snapshot stale.

## Usage

```ts
import { createSyncServer } from '@fieldnotes/sync-server';

const { close } = createSyncServer({ port: 8080 });
// ws://localhost:8080?room=my-room
```

## Authentication

Pass an `authenticate` hook to gate connections:

```ts
import { createSyncServer } from '@fieldnotes/sync-server';

createSyncServer({
  port: 8080,
  authenticate: async ({ req, room }) => {
    const token = new URL(req.url ?? '', 'http://x').searchParams.get('token');
    const member = await myCampaign.verify(token, room); // your app's check (Redis/DB/JWT)
    return member ? { userId: member.id, role: member.isDM ? 'dm' : 'player' } : null;
  },
});
```

`authenticate({ req, room }) → { userId, role? } | null` runs on each connection and
may be sync or async. Returning `null` (or throwing) **rejects** the connection: the
socket is closed with WS code `4401` and the connection is never admitted to the room —
no membership, no snapshot. A resolved result admits the connection carrying its
`userId` and optional `role`.

With **no hook**, rooms stay open: every connection is admitted anonymously with
`userId = connId`. `role` is captured now and enforced in an upcoming release
(role-based authorization and per-viewer visibility filtering).

Messages that arrive during an async auth (notably the client's initial
`request-snapshot`) are queued and replayed once the connection is admitted, so the
first snapshot is never lost to the auth round-trip.

### Passing a token

A browser `WebSocket` can't set request headers, so pass the token as a URL query
param (`ws://relay?room=R&token=…`) and read it from `req.url` in `authenticate`. URLs
land in access/proxy logs, so prefer **short-lived / single-use** tokens. Non-browser
clients can instead put the token in `req.headers` (e.g. `Authorization`), which
`authenticate` reads directly.

A Redis `HubBackend` and cross-instance fan-out ship in [`@fieldnotes/sync-redis`](../sync-redis).
