# CanvasState v4 migration

CanvasState v4 completes the Field Notes → VTT ownership boundary. Core state now persists only
core elements and extension envelopes; grid, template, and fog behavior remains owned by
`@fieldnotes/vtt`.

## Package set

Publish and adopt this set together:

| Package                   |  Version |
| ------------------------- | -------: |
| `@fieldnotes/core`        | `0.82.0` |
| `@fieldnotes/sync`        | `0.19.0` |
| `@fieldnotes/sync-server` | `0.18.0` |
| `@fieldnotes/sync-redis`  |  `0.9.0` |
| `@fieldnotes/vtt`         |  `0.8.0` |
| `@fieldnotes/react`       | `0.12.0` |

For registry and build dependencies, publish in the order shown above. Deploy server/Redis support
before clients so capability negotiation and legacy translation are available before a v4 client
connects.

## Required consumer changes

Import grid/template types and factories from VTT:

```ts
import { Viewport } from '@fieldnotes/core';
import { createGrid, createTemplate, registerVttElementTypes } from '@fieldnotes/vtt';
```

Register VTT definitions before loading persisted state:

```ts
registerVttElementTypes(viewport.elementRegistry);
viewport.loadState(savedState);
```

Register against the same `ElementRegistry` used by the viewport. Calling
`registerVttElementTypes()` twice on the same registry is an error.

Replace direct core-union checks and typed queries:

```ts
// Before
store.getElementsByType('grid');
element.type === 'template';

// v4
store.getElementsByType('extension').filter((element) => element.extensionType === 'vtt:grid');

element.type === 'extension' && element.extensionType === 'vtt:template';
```

Use the registered type key or adapter when typed VTT data is needed. Do not cast an extension
envelope to the old raw grid/template shape.

## Persistence behavior

- `exportState()` always writes `version: 4`.
- Extension elements stay as `type: 'extension'` envelopes.
- Plugin state stays under `extensions`.
- Top-level `fog` is not written.
- `Viewport.loadState()` accepts versions 1–4 and migrates older files before loading them.
- A legacy top-level `fog` value becomes `extensions.fog` unless that plugin entry already exists.
- Legacy `grid` and `template` records are decoded through registered VTT adapters. Import fails
  transactionally when an adapter is missing; core never returns a partially converted state.
- Versions newer than 4 fail explicitly.

Keep an immutable backup of production v3 state until the v4 client rollout and rollback window are
closed. A v3-only client correctly rejects a v4 document; it cannot safely edit or re-export it.

## Sync behavior

Clients and the relay exchange a capabilities control frame before extension-sensitive traffic.
Negotiation is bounded by message-count and time limits:

- capable peers receive extension envelopes and extension operations;
- peers that do not advertise capabilities lock into the legacy path after the timeout;
- upserts and snapshots are translated per peer through the element registry;
- unsupported extension operations use their registered legacy translator;
- a missing translator fails closed for that peer instead of sending lossy data;
- ordinary core operations remain available during negotiation, preserving v3 bootstrap behavior.

Per-peer translation applies to direct snapshots, authorization corrections, normal room relays,
plugin results, and cross-instance fanout. Audience filtering still runs before serialization, so
translation does not weaken the server privacy boundary.

## React snapping

`FieldNotesCanvas.snapToGrid` remains functional for compatibility but is deprecated. Grid snapping
belongs to the VTT domain; new consumers should configure `GridController` and the registered
constraint service.

## Rollout checklist

1. Publish the coordinated package set without changing production traffic.
2. Update and deploy the relay/Redis packages first.
3. Confirm capability replies, legacy translation, authorization corrections, filtered snapshots,
   and cross-instance fanout.
4. Update the RollKeeper client and verify v3 state imports into v4 with grid, template, and fog data.
5. Exercise a mixed peer room and confirm old peers receive legacy shapes while new peers receive
   envelopes.
6. Verify save/reload, reconnect, export, minimap, grid snapping, template handles, and undo.
7. Retain rollback artifacts and v3 state backups until the v4 observation window closes.

Do not partially deploy a v4 client ahead of the relay capability layer. Do not remove the legacy
adapter codecs until the mixed-peer support window is explicitly closed in a later release.
