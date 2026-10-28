# @fieldnotes/sync

Real-time element sync for the [Field Notes](https://github.com/IrakliDevelop/fieldnotes) canvas SDK.

This package keeps multiple Field Notes canvases in sync by streaming element changes over a
pluggable transport. It is framework-free vanilla TypeScript.

## Zero-infra proof: BroadcastChannel

`BroadcastChannelTransport` syncs canvases across tabs of the same origin with **no server**, using
the browser's [`BroadcastChannel`](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel)
API. It is the reference `SyncTransport` implementation — open two tabs, edit in one, see it in the
other. The same `SyncTransport` interface can be backed by WebSocket, WebRTC, or any other channel.

The transport is SSR-safe (degrades to a no-op when no `BroadcastChannel` is available) and accepts an
injectable `BroadcastChannel` factory for testing.

## Install

```bash
pnpm add @fieldnotes/sync @fieldnotes/core
```

Requires `@fieldnotes/core` `>=0.100.0` (peer dependency).

Domain operations are installed through `ClientSyncPlugin`. A plugin may register codec-validated
extension kinds and versioned snapshot state. For fog, install `createFogClientPlugin()` from
`@fieldnotes/vtt/sync`; this package does not depend on VTT at runtime.

## Wire limits

`SYNC_LIMITS` lists the caps `parseEnvelope` enforces on received frames: JSON depth 64,
identifiers and short strings 256 characters, text and arrow labels 1 MiB, image `src` 16 MiB,
100 000 stroke points, 1 000 000 snapshot elements, and 1 000 ops per batch. Over-limit frames are
dropped. `isWithinSyncLimits(envelope)` applies the same checks to an already parsed envelope.
`SyncClient` also checks each element op before sending: an op over a cap is not sent and is
reported as a `SyncLimitError` (`elementId`, `limit`) through `globalThis.reportError` when
available. The local store keeps the element.

## Capability handshake

`createCurrentCapabilities(extensionKinds)` advertises `{ protocolVersion: 3, extensionKinds,
elementEnvelope: true, elementHierarchy: 1 }` when a transport starts. The hierarchy marker is
required. There is no protocol-2 fallback or wire translation.

All durable outbound operations queue until matching capabilities complete negotiation. Inbound
substantive frames before matching capabilities are ignored or refused. Presence before admission is
not queued. Extension operations are sent only to peers that advertise their extension kind; an
unsupported kind fails explicitly rather than silently dropping domain data. `SyncOp`,
`SyncEnvelope`, and `SyncElement` describe both runtime and transport values. Use `isValidEnvelope`
and `isValidElement` at transport boundaries. Plugin snapshot state lives under the snapshot
operation's `extensions` map.

## Element versions and tombstones (0.28.0)

Version and tombstone behavior arrived with legacy protocol 2 in 0.28.0. The current protocol-3
boundary adds required hierarchy capabilities. Every element carries its `index`, `version`, optional
`editor`, and optional `parentId`.
`SyncClient` applies an incoming upsert or remove only when it is newer than the local element or
tombstone (`isNewerVersion`: higher version; on a tie, the editor that sorts later). This holds both
through a hub and peer to peer over `BroadcastChannel`. Removes carry a version and editor, clears
and snapshots carry tombstones, so a late upsert or a reconnecting peer no longer resurrects a
deleted element. Hub corrections (`from: 'hub'`) still apply as sent.

Protocol 1 and 2 peers cannot share a room with protocol-3 clients; upgrade every client and hub
together. When a hub or peer advertises a missing or old hierarchy capability, `SyncClient` stops
syncing and closes its transport. A managed connection treats that, or a `4406` close from the hub,
as terminal: status `'unsupported'`, no reconnect. `parseLegacyEnvelope` validates the versioned
legacy grammar used by protocol 3; `parseEnvelope` is unchanged.

## Op batching (0.29.0)

`SyncClient` queues local element ops and sends the queue at most every `flushIntervalMs`
(default 50 ms, so 20 flushes per second). An upsert sends the element's state at flush time, so a
drag sends one op per element per flush. An element deleted before the flush, for example by a
remote remove, is not sent. Element frames, snapshot re-pushes included, wait up to
`flushIntervalMs`; the audience of a queued element is resolved at flush time. `flush()` sends the
queue now, and the queue is sent before clears, snapshots, snapshot requests, layer and extension
ops, and `stop()`. Pass `flushIntervalMs: 0` to send every op synchronously, for example in tests.

```ts
const client = new SyncClient({ store, transport, flushIntervalMs: 0 });
```

A flush goes as `batch` frames through an admitted protocol-3 hub that advertises `opBatching`.
Batches are split to stay within the frame byte and depth limits; an op too large for a batch goes
alone. An admitted hub without that marker and peer-to-peer sync use individual operation frames.

Batching stops when the transport reports a close and resumes after the next hub handshake.
`WebSocketTransport` implements the optional `SyncTransport.onClose(handler)`; custom transports
should implement it too, so ops buffered while disconnected go as single ops.

A hub may reply `unsupported` (protocol version, minimum version, reason) before closing with
`4406`. `SyncClient` stops, and a managed connection settles `'unsupported'` and exposes the reason
through `getUnsupportedReason()`.

Client tombstones are pruned when a snapshot is built or received once they are older than
`tombstoneRetentionMs` (default 7 days).

## Authority wire primitives

`createAuthorityCapabilities(extensionKinds)` uses capability revision 2 and adds `authority: 1`
and `elementHierarchy: 1` to the current capability shape. `supportsAuthority` checks the marker.
Existing connections continue to call `createCurrentCapabilities` and do not advertise or negotiate
authority automatically. Capability revision 2 is separate from the serialized native
`authority:1` frame literal.

`parseAuthorityClientFrame`, `parseAuthorityServerFrame`, and `parseAuthorityFrame` validate
direction-specific `authority:1` frames and return frozen values or `null`. The matching
`serializeAuthorityFrame` writes deterministic, UTF-16-key-sorted JSON within the 1 MiB frame
limit. These codecs validate wire structure only; they do not authorize a mutation or apply it.
Legacy `parseEnvelope` and authority parsing remain separate.

Proposed element upserts are capped per field by `AUTHORITY_ELEMENT_LIMITS` (ids and short strings
256 characters, text 1 MiB, `src` 16 MiB, 100 000 stroke points). `changes` frames and checkpoints
are not capped, so stored data over a cap never makes a client frame unparseable.

`AuthorityCursor` tracks a contiguous visible projection within one generation and stream.
`classifyAuthorityCursor` reports next, stale, gap, or reset without comparing revisions across
streams. A durable `AuthorityReceipt` has no applied-state cursor. Whole-room compare-and-swap
uses the separate opaque `expectedState` token; a clear proposal requires it. Checkpoint manifests
and chunks are syntax-validated here.

## Authority checkpoints (0.23.0)

`prepareAuthorityCheckpoint` captures supplied state before its first await, validates the exact
trusted extension inventory, and returns a frozen manifest plus a one-shot lazy frame iterator.
The caller must capture a coherent projection and await each physical transport send before pulling
the next frame. Call `dispose()` or `frames.return()` when abandoning iteration without aborting.
An `AbortSignal` also releases retained bytes. Preparation uses browser WebCrypto SHA-256 and fails
closed when unavailable.

`AuthorityCheckpointAssembler` accepts serialized server frames for one checkpoint lifetime. It
returns a complete, deeply frozen value only after exact chunk sizes, hash, canonical JSON, cursor,
CAS token, inventory, and extension validators pass. A missing or invalid frame fails the instance;
retry with a new assembler. The ten-second deadline starts at the accepted begin frame and never
resets. The trusted requirement list is independent of peer data: even if both manifest and payload
omit a required extension, assembly fails. Validators must be synchronous pure predicates because
the library cannot undo their external effects. These APIs verify supplied correspondence and do
not authorize, atomically capture, apply, or activate a checkpoint in a live connection.

The serializer budgets bytes, depth, nodes, and enumerable keys. Native reflection of hidden or
symbol-only keys and arbitrary Proxy traps remains outside the application-level allocation bound.

The serializer budgets output and the enumerable keys it retains before sorting. JavaScript
reflection has no bounded way to enumerate nonenumerable or symbol-only own keys, so the final
exact rejection check may allocate their full inventory; arbitrary Proxy traps have the same
language-level limitation. Do not pass untrusted live JavaScript objects directly to the
serializer without an application-level input boundary. Parsed JSON frames remain byte, depth,
and node bounded before validation.

## Authority operation IDs (0.24.0)

`createAuthorityOperationId(issuedAt = Date.now())` generates
`fn1:<13-digit Unix milliseconds>:<32 lowercase hex>` using browser Web Crypto random bytes.
It throws if the timestamp is outside the required 13-digit integer range or secure random
bytes are unavailable. The enabled server authority runtime accepts this profile and checks
it against backing-store time (at most 60 seconds ahead, at most 24 hours old, and newer than
the generation's retired-ID floor). The general C1 parser still accepts its earlier printable
operation-ID grammar for compatibility; generating a C1-valid ID does not make it admissible
to an authority room.

Keep the original complete proposal and ID after a send with an uncertain outcome. Retry the
same bytes and ID to recover a retained durable receipt. An expired retry is unresolved,
not permission to automatically create a fresh ID for the same logical action. Receipts prove
durable commit but carry no applied-state cursor.

## Managed authoritative client (0.25.0)

`createManagedAuthorityConnection` is the opt-in high-level authority client. It owns capability
negotiation, credentials/endpoints, one socket episode at a time, recovery, exact retained proposal
wires, a deeply frozen canonical document, receipt barriers, and coherent checkpoints. The legacy
`createManagedSyncConnection`, `SyncClient`, plugin path, and `WebSocketTransport` remain the
separate legacy path and negotiate protocol 3 plus `elementHierarchy: 1`. The authority manager is
opt-in and separate.

```ts
import {
  createAuthorityClientExtension,
  createAuthorityExtensionReducer,
  createExtensionKind,
  createManagedAuthorityConnection,
} from '@fieldnotes/sync';

const labelKind = createExtensionKind({
  extensionKind: 'labels:set',
  codec: { validate: (value: unknown): value is string => typeof value === 'string' },
});
const labelReducer = createAuthorityExtensionReducer<string, string>({
  kind: labelKind,
  reduce: (_state, label) => label,
});
const labels = createAuthorityClientExtension({
  key: 'labels',
  pluginName: 'my-presentation',
  version: 1,
  validate: (value: unknown): value is string => typeof value === 'string',
  reducers: [labelReducer],
});

const connection = createManagedAuthorityConnection({
  scopeId: 'principal-42/room-7',
  clientId: crypto.randomUUID(),
  extensions: [labels],
  resolveUrl: async () => ({ url: await getShortLivedWebSocketUrl() }),
});

const unsubscribe = connection.subscribe(() => {
  const state = connection.getState();
  renderCanonical(state.document); // presentation only
});
```

Options are captured synchronously. `scopeId` identifies one principal/room authority scope; create
a new manager when that identity changes. `resolveUrl` may refresh a short-lived endpoint within the
same scope. The manager does not retain credentials or URLs in public state. A custom
`transportFactory` may supply the small non-buffering `AuthorityClientTransport` interface;
otherwise `createAuthorityWebSocketTransport` is used. The default adapter requires browser
`WebSocket`, accepts text only, and does not reconnect or queue on its own. In SSR it fails closed to
an offline manager; construct client connections in browser lifecycle code and always call
`stop()` during teardown.

`getState()` returns the same deeply frozen reference until a real transition. Status is
`connecting`, `recovering`, `live`, `offline`, `denied`, `upgrade-required`, or `stopped`.
`document` is either `null` or the SDK-owned canonical `{ cursor, casToken?, elements, layers,
extensions }`. It becomes available only after exact capabilities, generation, and a fully
validated fresh checkpoint. Layer tombstones and extension state are preserved. Project canonical
elements into a UI/store with that store's remote origin, if available. Elements written before
core 0.93 still carry `zIndex` instead of `index`; run `assignLegacyOrder(elements)` from
`@fieldnotes/core` over the whole document's elements before loading them into a core store.
Canonical replacement is atomic inside this SDK; arbitrary projection callbacks and destination
stores are not claimed to be atomic, and presentation failures cannot change canonical state.

`submit(mutation, { expectedState? })` retains an immutable parsed proposal and its exact serialized
wire. A clear requires an explicit checkpoint CAS token. Submitting while not live may retain a
`draft`; a handed-off operation is `pending`; outcomes become `accepted`, `rejected`, or
`uncertain`. A receipt changes only the operation record to durable `accepted`: **it does not mean
the mutation has reached `state.document`, a viewport, or application storage, and it is not a
save confirmation**. Ordered `changes` or a complete checkpoint advance canonical state.

There is no automatic replay on reconnect, recovery, or generation replacement. Call
`retryOperation(id)` only for a same-generation retained draft/uncertain operation; it sends the
exact original ID, CAS, and wire. To intentionally make a new logical edit, call `submit()` with the
retained `operation.proposal.mutation` and warn users that uncertain work may already have committed,
so reapplication can duplicate an effect. `releaseOperation(id, { discardDraft: true })` explicitly
abandons tracking of unaccepted work; it does not prove that a prior attempt failed. Accepted work
may be released when no barrier pins it.

`captureBarrier()` freezes the currently retained operation IDs and edit cut. Await
`waitForAcknowledgements(barrier)` and require `status === 'acknowledged'` before treating all IDs as
durably receipted. Even then, the result says nothing about applied cursor or saving. Pass that same
barrier to `requestCheckpoint({ barrier })` to issue a coherent checkpoint request only after the
receipt cut. A later local edit remains beyond the barrier even if server timing includes its effect
in the returned checkpoint. Release finished barriers explicitly.

Barrier/checkpoint promises report typed expected failures (`blocked`, `timeout`, `aborted`,
`stopped`, `invalid`, `capacity`, `recovery`, `crypto`, and access/upgrade outcomes) rather than
throwing. Caller timeouts are integers from 1–60,000 ms. Cancellation detaches only that caller.
Fixed safety bounds include 1 MiB frames, 20 MiB checkpoints, 64 retained operations/4 MiB wire,
64 inbox frames/4 MiB, 16 barriers/1,024 pinned references, 32 shared waiters, 64 listeners, and one
transport, credential resolution, and checkpoint verification at a time. Subscriber and trusted
synchronous extension callback exceptions are contained, but applications should still keep them
small and side-effect aware.

Typed extensions are required capabilities, not optional migrations. Every registered key,
plugin/version, generic kind, and legacy reducer owner must match the server inventory exactly.
Inputs are bounded-copied and deeply frozen; invalid, throwing, thenable, oversized, or missing
extension results reject the whole candidate and preserve the prior canonical document. The helper
types retain payload inference without exporting the internal registry.

Authority extensions may also opt in to legacy fog ownership with `legacyKinds: ['fog-meta',
'fog-patch']`. This inventory is separate from generic `extensionKinds`, is snapshotted during
registration, and must be duplicate-free across the room. The managed client advertises the exact
combined inventory and applies a legacy fog change only through its registered authority reducer.
Legacy plugins remain unchanged and are not an authority-room mutation path.
