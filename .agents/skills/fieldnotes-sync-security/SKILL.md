---
name: fieldnotes-sync-security
description: Trust-boundary rules for Field Notes sync, server, Redis, and persistence covering authentication, server-decided audience, per-viewer read filtering, ownerId stripping, protocol compatibility, and sanitization. Use when changing or reviewing packages/sync, packages/sync-server, packages/sync-redis, VTT sync or server subpaths, or state serialization.
---

# Field Notes sync security

Hidden data must never be sent, not merely hidden in the UI. A byte that reaches a viewer's socket
is disclosed, whatever the client does with it.

## Scope

`packages/sync/src` (protocol, capabilities, transports), `packages/sync-server/src` (hub, auth,
frame policy, authority runtime), `packages/sync-redis/src`, the VTT `/sync`, `/server`, and
`/redis` subpaths (`packages/vtt/src/sync.ts`, `server.ts`, `redis.ts`), and persistence in
`packages/core/src/core/state-serializer.ts` and `packages/core/src/elements/note-sanitizer.ts`.

## Invariants

**Audience and authorization** (`packages/sync-server/src/sync-hub.ts`, hook types in
`authorize.ts`)

- The server decides audience: on an incoming upsert, `resolveAudience` runs before `authorize`.
  A client-supplied audience is never trusted.
- `mayRead` gates every outbound element. A viewer that could read an element and no longer can
  receives a `remove`; removes go only to viewers who could see the element.
- A denied edit gets a correction (`sendCorrection`) to the sender only, never a broadcast.
- `ownerId` is stripped from every outbound frame (`stripOwnerId`) unless the `CanReadOwnerId` hook
  allows it for that viewer.
- Authentication comes before authorization: `createSyncServer` refuses an `authorize` hook
  without an `authenticate` hook (see `security.e2e.test.ts`). `authorizeLayer` has no such guard;
  without `authenticate` its `userId` is the per-socket connection id.

**Startup guards and origin** (`create-sync-server.ts`, `SyncHub` constructor)

- `createSyncServer` throws without `authenticate` unless `allowAnonymous: true`, and throws when
  both are set. Never add a default that admits anonymous sockets.
- With `canRead`, `SyncHub` throws without `resolvePresenceAudience` or `canReadLayer`, so a host
  that filters elements cannot leak presence or layer names by omission.
- `allowedOrigins` refuses a browser upgrade from an unlisted origin with HTTP 403 before
  `authenticate`; a throwing host check refuses. A request without `Origin` passes.

**Presence**

- The origin instance resolves one audience per client presence frame with
  `resolvePresenceAudience`; a throw drops the frame. The audience travels on fanout so every
  instance filters for its own members.
- With `canRead`, every presence frame (client, `broadcastPresence`, fanout) passes `canRead`,
  untagged ones with `audience: undefined`. Without `canRead`, presence is a plain relay.

**Layers**

- `canReadLayer` gates every outbound layer definition: live ops, snapshots, and sender
  corrections (a sender who cannot read the stored record gets the unknown-id answer). A throw
  denies.
- A layer op on fanout carries `prevLayer`, the previous definition, so each receiving instance
  sends a `layer-remove` to a viewer who could read the old record but not the new one.
- Layer tombstones in snapshots carry only an id and a version and reach every viewer; a live
  layer remove goes only to viewers who could read the layer.

**Element read gates** (`packages/sync-server/src/element-gates.ts`, `sync-hub.ts`)

- A viewer receives an element only when `canRead` allows its audience and every plugin
  `elementReadGate` returns exactly `true`. A throw, any other value, or gates not yet loaded for
  the room withholds; a gate never fails open.
- Every outbound element path uses the combined check: live relay, fanout, snapshots, sender
  corrections and element ops a plugin returns. While a reconcile is pending, a viewer the old or
  the new gates allow gets the remove.
- A gate change never rewrites stored elements, their versions or `audience`; the hub sends hub
  removes and upserts per viewer instead.
- A plugin with `elementReadGate` requires `resolvePresenceAudience` (`SyncHub` throws), so a drag
  cannot leak a gated element's position through presence.

**Image sources**

- The hub refuses an image upsert whose `src` fails `isAllowedImageSrcScheme`
  (`packages/sync/src/protocol.ts`) or the host's `allowImageSrc`, with a sender correction, and
  drops stored refused images from every outbound frame.

**Snapshots**

- Snapshots are filtered by `mayRead`, then by each plugin's `filterSnapshot`. A new snapshot field
  passes through both.
- Live plugin-owned ops (relay, sender corrections, fanout on the receiving instance) are filtered
  per recipient by the owning plugin's `filterOp`. A throw or any non-op result withholds the frame.

**Fog**

- `createFogServerPlugin` (`packages/vtt/src/server.ts`) throws without `authorize` or
  `allowAnyWriter: true`, and when `filterSnapshot` is set without `filterOp`. A throwing
  `authorize` denies the write. It passes the host's `filterSnapshot` and `filterOp` to the hub.
- The server applies no built-in fog redaction; hosts must supply it. Without `seesUnderFog`, fog
  is a display aid and elements under it reach every client. With it, the plugin's gate withholds
  elements fully under fog (`isElementCoveredByFog`, `packages/vtt/src/fog/fog-coverage.ts`);
  the fog mask, the map image, partly covered elements, custom extension types, presence and the
  ids of deleted elements still reach every client.
- Secrets belong on elements whose audience `canRead` denies to the viewer. `canReadLayer` hides
  only the layer record, not the elements on it.

**Protocol**

- Versions: `LAYER_SYNC_PROTOCOL_VERSION` (`packages/sync/src/protocol.ts`),
  `FOG_SYNC_PROTOCOL_VERSION` (`packages/sync/src/fog-wire.ts`, duplicated in
  `packages/vtt/src/fog/fog-sync-types.ts`; keep the two equal), `AUTHORITY_PROTOCOL_VERSION`
  (`packages/sync/src/authority-protocol.ts`).
- Capabilities negotiate features (`CapabilityHandshake`, `translateOpForPeer` in
  `capabilities.ts`). `translateOpForPeer` throws for an extension kind the peer does not
  advertise, so the caller skips the op; element ops pass through unchanged.
- An old `isValidEnvelope` rejects new op kinds, so old clients drop them. Adding fields is
  compatible; changing the meaning of an existing field is not.

**Persistence**

- `CANVAS_STATE_VERSION` versions persisted state. `parseState` validates first (rejecting a
  version newer than `CANVAS_STATE_VERSION`), then `migrateState` upgrades older versions.
- Rich text passes through `sanitizeNoteHtml` (tag allowlist, attributes stripped) on add, update,
  load, and parse.

## Known gap

The hub checks image `src` schemes, but core persistence does not: `state-serializer.ts` checks
image `src` only with `isString`, and VTT has no scheme allowlist. Flag every change that touches
URLs; do not widen the gap.

## Mandatory tests

For a new op, hook, or filter:

1. Adversarial cases: unauthenticated, wrong role, wrong room, audience revoked mid-session,
   oversized frame.
2. Both paths: live relay and snapshot. For presence, the client, `broadcastPresence`, and
   fanout paths; for layers, live ops, snapshots, sender corrections, and fanout with
   `prevLayer`.
3. Mixed-version peer: an old validator drops the new kind (`packages/sync/src/protocol.test.ts`).
4. Redis fan-out keeps the filtering when the change touches `sync-redis`
   (`redis-fog.integration.test.ts`; state when Redis was unavailable).

Extend the existing suites: `security.e2e.test.ts`, `frame-policy-matrix.e2e.test.ts`,
`sync-hub.test.ts`, and the `authority-*.test.ts` files in `packages/sync-server/src`.

## Review checklist

- Every outbound path for the new data (relay, snapshot, correction, Redis fan-out) goes through
  `mayRead` and `stripOwnerId`, or `canReadLayer` for layer definitions.
- No audience, role, or owner taken from the client frame.
- Versions and capabilities updated together; the duplicated fog constant still matches.
- Assert absence: tests check the forbidden bytes are not in the frame, not that the UI hides them.
