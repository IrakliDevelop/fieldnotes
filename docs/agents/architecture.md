# Architecture map

## Workspace ownership

| Path                                               | Responsibility                                                  | Primary verification                                     |
| -------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| `packages/core` (`@fieldnotes/core`)               | Framework-free canvas engine, public model, browser interaction | core tests/build; e2e for browser behavior               |
| `packages/react` (`@fieldnotes/react`)             | Thin React lifecycle, context, and components over core         | react tests/build; core build when consumed API changes  |
| `packages/sync` (`@fieldnotes/sync`)               | Transport-neutral client, wire protocol, browser transports     | sync tests/build; protocol compatibility tests           |
| `packages/sync-server` (`@fieldnotes/sync-server`) | Authoritative relay, auth, authorization, heartbeat             | server tests/build; sync tests for shared contracts      |
| `packages/sync-redis` (`@fieldnotes/sync-redis`)   | Redis persistence and cross-instance fan-out                    | redis tests/build; integration environment when required |
| `demo`                                             | Manual vanilla playground                                       | demo build and focused smoke test                        |
| `examples/react-app`                               | React integration example                                       | example build                                            |
| `examples/live-play`                               | Collaboration reference app                                     | example tests/build                                      |
| `website`                                          | Project website                                                 | website build                                            |

Dependencies flow from wrappers and adapters toward contracts: React and sync depend on core; server
depends on sync; Redis depends on sync and implements server integration contracts. Do not introduce
reverse dependencies.

## Core request path

`Viewport` in `packages/core/src/canvas/viewport.ts` is the composition root. It coordinates camera,
render loop, input, element store, layers, history, DOM elements, editing, and focused controllers.
Keep orchestration there and behavior in the narrowest collaborator.

- `canvas/`: viewport/camera, input/keyboard routing, rendering, export, interactions.
- `core/`: generic geometry, events, indexing, persistence, serialization.
- `elements/`: element union/factories/store, geometry, editing, rendering.
- `tools/`: tool strategies and selection transforms.
- `history/`: commands, transaction recording, undo/redo.
- `layers/`: ordering, visibility, locking, and opacity.
- `integration/`: cross-subsystem behavior tests.

Rendering is hybrid: canvas handles drawing-heavy content and DOM handles interactive embedded
content. Camera transforms must align both layers. Render changes must consider culling, cache
invalidation, device-pixel ratio, export parity, and visual snapshots.

## Contracts needing extra caution

- `packages/core/src/index.ts`: public surface and `VERSION`.
- `packages/core/src/elements/types.ts`: persisted discriminated union.
- serializer/storage: backward compatibility and sanitization.
- tool/input/history boundary: cancellation and one-gesture/one-undo semantics.
- `packages/sync/src/protocol.ts`: client/server wire compatibility.
- auth, authorization, and read filtering: hidden data must never be sent to a viewer.
- React cleanup: subscriptions and owned viewports must be disposed exactly once.

Before changing a shared helper, use `rg` to enumerate every caller. Before adding an abstraction,
look for the nearest existing strategy, controller, pure helper, or adapter pattern.
