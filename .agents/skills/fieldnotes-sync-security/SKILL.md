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

**Snapshots**

- Snapshots are filtered by `mayRead`, then by each plugin's `filterSnapshot`. A new snapshot field
  passes through both.

**Fog**

- `createFogServerPlugin` (`packages/vtt/src/server.ts`) authorizes fog ops and passes through the
  host's `filterSnapshot`. The server applies no built-in fog redaction; hosts must supply it.

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

Image `src` is checked only with `isString` in `state-serializer.ts`; no URL scheme allowlist
exists in core or VTT. Flag every change that touches URLs; do not widen the gap.

## Mandatory tests

For a new op, hook, or filter:

1. Adversarial cases: unauthenticated, wrong role, wrong room, audience revoked mid-session,
   oversized frame.
2. Both paths: live relay and snapshot.
3. Mixed-version peer: an old validator drops the new kind (`packages/sync/src/protocol.test.ts`).
4. Redis fan-out keeps the filtering when the change touches `sync-redis`
   (`redis-fog.integration.test.ts`; state when Redis was unavailable).

Extend the existing suites: `security.e2e.test.ts`, `frame-policy-matrix.e2e.test.ts`,
`sync-hub.test.ts`, and the `authority-*.test.ts` files in `packages/sync-server/src`.

## Review checklist

- Every outbound path for the new data (relay, snapshot, correction, Redis fan-out) goes through
  `mayRead` and `stripOwnerId`.
- No audience, role, or owner taken from the client frame.
- Versions and capabilities updated together; the duplicated fog constant still matches.
- Assert absence: tests check the forbidden bytes are not in the frame, not that the UI hides them.
