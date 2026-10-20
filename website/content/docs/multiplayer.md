---
title: Multiplayer
description: By the end of this page you have a relay running on your own server, boards in several browsers sharing one room, and players who receive only the elements they may see.
group: Guides
order: 6
---

`@fieldnotes/sync-server` is a WebSocket relay you run on your own Node server, and `@fieldnotes/sync` connects a board to it.

## Install

```bash
npm install @fieldnotes/sync-server
npm install @fieldnotes/core @fieldnotes/sync
```

The first line is for the server and the second for the app. `@fieldnotes/sync` needs `@fieldnotes/core` 0.93.0 or newer.

## Run the relay

::code{example="multiplayer" region="relay"}

`createSyncServer` starts a WebSocket server on the port. A board joins a room with `?room=<id>` in the URL, where the id is 1 to 64 letters, digits, `_` or `-`. A missing or invalid id closes the socket with code 4400.

The relay keeps each room's elements, sends them to each person who joins, and passes every change on to the others in the room. `close()` closes the open sockets with code 1001 and stops the server.

## Connect a board

::code{example="multiplayer" region="connect"}

- `WebSocketTransport` opens the socket when it is created. When the connection drops it reconnects, waiting longer after each failure, up to 10 seconds. It doesn't reconnect after a close code from 4000 to 4999, which the relay uses to refuse a connection.
- `client.start()` asks the relay for the room and starts sending the board's changes. It sends them at most every 50ms (`flushIntervalMs`), so a drag sends one update per element per flush.
- Changes from other people arrive with origin `'remote'`, so mod+Z undoes only your own, as [Undo and history](/docs/undo-and-history/) explains.
- Elements sync on their own. Layer changes reach other people only when the client has the `layers` option and your code publishes each change with `client.publishLayerUpsert(layer)`.
- Call `client.dispose()` and `transport.close()` when the board goes away.

## Sign people in

`authenticate({ req, room, token })` decides who joins. It returns `{ userId, role }` to admit the connection, or `null` to close it with code 4401 before it receives anything from the room.

A browser can't set headers on a WebSocket, so the client offers the token with `bearerSubprotocols(token)`, as in the client code further down. The relay also reads an `Authorization: Bearer` header, and a `token` query parameter, which ends up in server logs.

Without `authenticate`, every connection joins, and its `userId` changes each time it reconnects.

## Decide who may change what

`authorize` runs before the relay applies each upsert, remove or clear. A denied change is not stored and is sent to no one, and the sender gets a correction that puts their board back. `createSyncServer` throws when `authorize` is set without `authenticate`, because ownership needs a `userId` that stays the same across reconnects.

The relay stamps each new element with its creator's `userId` as `ownerId`, keeps it through edits and ignores any `ownerId` a client sends, so `authorize` can trust `currentElement.ownerId`. It removes `ownerId` from everything it sends, unless `canReadOwnerId` allows that viewer to see it.

## Send each person only what they may see

`canRead({ userId, role, room, audience })` decides whether a viewer receives an element. The relay checks it before sending, for live changes and for the room a person receives on joining, so a hidden element never reaches that player's browser. Without `canRead`, everyone receives everything.

`audience` is a tag on each element. These rules give the game master (role `gm`) elements no player receives:

::code{example="multiplayer" region="server-rules"}

The client tags each element from the layer it is on:

::code{example="multiplayer" region="client-rules"}

A client can send any tag, so the relay's `resolveAudience` decides the tag it stores. Here a GM's tag is kept, and a player's element keeps its stored tag or becomes `shared`. Without `resolveAudience` on the relay, `authorize` has to check the tag itself.

When an element moves to an audience a viewer can't read, that viewer receives a remove, and when it moves back, an add. With several relay instances, each one filters for its own connections, so all of them need the same `canRead`.

## Keep rooms in Redis

Without Redis, room state lives in one process. The relay keeps every room in memory, a restart loses them, and a second relay instance can't see them. Rooms nobody uses stay in memory unless you set `roomIdleTimeoutMs`, which deletes a room's board once it has had no connection for that long.

`@fieldnotes/sync-redis` stores rooms in Redis. Pass `new RedisHubBackend(client)` as `backend`, with a node-redis v4 client or a small ioredis adapter, and rooms survive restarts and are shared by every instance. For people on different instances to see each other's changes live, also pass `fanout: new RedisHubFanout(publisher, subscriber)`, where the subscriber is a connection of its own. The [sync-redis README](https://github.com/IrakliDevelop/fieldnotes/blob/master/packages/sync-redis/README.md) shows both setups and room expiry.

The [sync-server README](https://github.com/IrakliDevelop/fieldnotes/blob/master/packages/sync-server/README.md#resource-limits) lists the relay's rate limits, connection caps and heartbeat.
