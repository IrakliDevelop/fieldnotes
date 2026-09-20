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
