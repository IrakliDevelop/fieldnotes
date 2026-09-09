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

Domain operations are installed through `ClientSyncPlugin`. A plugin may own legacy v3 operation
kinds during a compatibility window and may register codec-validated extension kinds and versioned
snapshot state. For fog, install `createFogClientPlugin()` from `@fieldnotes/vtt/sync`; this package
does not depend on VTT at runtime.

## Mixed-version peers

The client advertises its CanvasState and extension-envelope capabilities when a transport starts.
Extension-sensitive traffic waits for that bounded handshake; peers that do not reply are treated as
legacy peers. Registered element and plugin codecs translate envelopes and extension operations for
those peers, while ordinary core operations continue during negotiation. Missing translations fail
explicitly instead of silently dropping domain data.
