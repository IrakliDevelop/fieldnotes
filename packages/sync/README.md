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

Requires `@fieldnotes/core` `>=0.82.0` (peer dependency).

Domain operations are installed through `ClientSyncPlugin`. A plugin may register codec-validated
extension kinds and versioned snapshot state. For fog, install `createFogClientPlugin()` from
`@fieldnotes/vtt/sync`; this package does not depend on VTT at runtime.

## v4 capability handshake

The client advertises `{ protocolVersion: 1, extensionKinds, elementEnvelope: true }` when a
transport starts. The literal `elementEnvelope: true` remains as a rolling-upgrade marker so current
clients interoperate with the immediately preceding v4 release. Frames that omit the marker or set
it to `false` are rejected; there is no timeout-based legacy fallback or v3 wire translation.

Extension-envelope traffic waits in a bounded queue until the handshake completes; later element
operations queue behind it to preserve order. Extension operations are sent only to peers that
advertise their extension kind; an unsupported kind fails explicitly rather than silently dropping
domain data. `SyncOp`, `SyncEnvelope`, and `SyncElement` describe both runtime and transport values.
Use `isValidEnvelope` and `isValidElement` at transport boundaries. Plugin snapshot state lives under
the snapshot operation's `extensions` map.

## Authority wire primitives (0.22.0)

`createAuthorityCapabilities(extensionKinds)` explicitly adds `authority: 1` to the current
capability shape. `supportsAuthority` checks that marker. Existing connections continue to call
`createCurrentCapabilities` and do not advertise or negotiate authority automatically.

`parseAuthorityClientFrame`, `parseAuthorityServerFrame`, and `parseAuthorityFrame` validate
direction-specific `authority:1` frames and return frozen values or `null`. The matching
`serializeAuthorityFrame` writes deterministic, UTF-16-key-sorted JSON within the 1 MiB frame
limit. These codecs validate wire structure only; they do not authorize a mutation or apply it.
Legacy `parseEnvelope` and authority parsing remain separate.

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
not permission to automatically create a fresh ID for the same logical action. Checkpoint
and reconcile the draft explicitly. Receipts prove durable commit but carry no applied-state
cursor. Complete checkpoints and `changes` advance the applied cursor; a managed authority
client with pending, barrier and recovery semantics is a later delivery slice. The current
managed client does not negotiate `authority:1`.
