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

## Usage

```ts
import { createSyncServer } from '@fieldnotes/sync-server';

const { close } = createSyncServer({ port: 8080 });
// ws://localhost:8080?room=my-room
```

Auth and a Redis `HubBackend` are upcoming.
