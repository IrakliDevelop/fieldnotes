# ADR-0009: Parent-child relationships and rectangular clipping

- **Status:** Accepted
- **Deciders:** Project maintainer
- **Date:** 2026-10-26
- **Supersedes:** —
- **Related:** [ADR-0002](0002-render-surface-model.md) (render surfaces),
  [ADR-0003](0003-sync-plugin-ownership.md) (sync plugin ownership),
  [ADR-0004](0004-serialization-compatibility.md) (serialization compatibility),
  [ADR-0008](0008-element-versioning.md) (element versioning and ordering)

## Context

Field Notes has layers, groups, fractional element order, cache-backed canvas rendering, live
canvas rendering, DOM elements, minimap rendering, and canvas and SVG export. It has no persisted
parent-child relationship or common clipping contract. Adding either independently would leave
each consumer to interpret relationship data and clipping differently.

The hierarchy change needs one persisted model, one scene projection, and a coordinated state and
protocol boundary. This record fixes that contract. Core 0.100.0, sync 0.30.0, sync-server 0.30.0,
and sync-redis 0.15.0 implemented it on 2026-10-27.

## Decision

### 1. Store parent relationships on children

`BaseElement.parentId?: string` is stored on the child. `groupId` remains independent, and a
migration does not turn existing groups into parents. A parent and every descendant share one
layer. The maximum hierarchy depth is 32. Neither endpoint of a relationship may be an element
whose definition is `fullCanvas`.

No public child-id array is persisted. Core provides read-only child and descendant queries, and a
viewport command mutates relationships.

### 2. Validate raw storage and project the scene once

Local and host add, update, and snapshot-load operations reject a missing parent, self-parenting,
a cycle, a cross-layer relationship, a full-canvas relationship, or depth greater than 32 before
mutation.

Explicit remote upserts may be temporarily invalid or arrive child-first. Raw storage remains
available for sync repair. One store-owned projection omits invalid and orphaned elements from
ordinary scene and query consumers until their relationships are valid. Rendering, spatial queries,
selection, marquee, activation, DOM placement, minimap, and export consume that projection. They
do not each interpret `parentId`.

Within each layer, scene order is stable depth-first order. Roots sort by `index`, then `id`. Each
parent's children sort by the same keys. A parent comes before its subtree.

### 3. Define subtree mutation semantics

Clicking or selecting a child selects that child. Clicking or selecting a parent selects that
parent. Moving or nudging a selected parent moves every descendant by the same delta. Descendant
locks block direct manipulation, but do not detach or block movement through the parent. A parent
move and every descendant update form one history transaction and undo step. Cancellation restores
every member and records no history step.

Deleting a parent deletes its full subtree in the same transaction. Copying or duplicating a
selected parent includes its descendants and remaps every copied `parentId`. Copying a child
without its parent clears the clone's `parentId`. Moving a parent to another layer moves its
subtree atomically. Moving a child alone to another layer clears its parent unless that parent
moves with it. A root or parent z-order command treats its subtree as one contiguous unit. A child
z-order command stays within its siblings. Group expansion and parent expansion compose without
updating one element twice. Drag containment does not assign a parent. Frames and membership
policy remain later work.

### 4. Clip descendants with rectangular bounds

`ElementTypeDefinition.clipBounds?(element)` returns an axis-aligned world `Bounds | null`. A
parent's clip applies only to descendants. Nested clips intersect from root to leaf. A descendant
outside the effective rectangle is neither drawn nor hit. A partial intersection is clipped.

The effective rectangle applies to cache and live canvas paths, canvas-routed HTML, DOM placement,
activation, minimap, PNG export, and SVG export. DOM uses a child-local polygon for the world-space
rectangle. SVG uses deterministic export-local ordinal ids with a per-export prefix and collision
check. It never embeds raw element ids in XML ids or URL fragments.

Clipping changes pixels and hit testing, not stored geometry. Export and fit-to-content bounds use
raw geometry. Arbitrary clip paths are deferred as a later additive contract.

### 5. Coordinate persistence and admission

Canvas state becomes v6. State v1 through v5 migrates with no relationship. Future versions remain
rejected.

Legacy sync uses protocol 3 and authority capabilities use revision 2. Both require
`elementHierarchy: 1` in the first admitted capability frame. The native authority frame literal
remains `authority:1`. Extension inventories and manifests retain their existing per-peer rules.

Until admission succeeds, no snapshot, mutation, correction, persistence, relay, checkpoint,
receipt, or presence traffic is admitted. JSON property or inventory order does not cause a
mismatch. A substantive frame before capabilities, an old or missing marker, or a repeated
capability frame whose normalized content changes receives legacy `unsupported` or authority
`authority:1` `upgrade-required` before close code 4406. Legacy receives the same five-second
admission bound already used by authority. Disconnect clears that bound.

Relation data never enters presence. Authorization remains element by element. An independently
forbidden child is absent from bytes. An independently allowed child whose parent is filtered may
still be sent, then fails closed in the recipient projection. Authorization does not gain a
transitive relationship closure.

### 6. Defer field-schema descriptors

Field-schema descriptors remain future inspector and element-augmentation work. Core has no
consumer for them today. They are outside this ADR and this release.

## Alternatives considered

### Parent-owned child arrays

Storing child ids on parents duplicates relationship state and makes concurrent repair harder.
Rejected in favour of one optional `parentId` on the child and derived queries.

### Reusing `groupId`

Groups and parent-child relationships have different command and clipping semantics. Reusing
`groupId` would change existing group data during migration. Rejected.

### Mixed old and new hierarchy peers

Translating hierarchy traffic for peers that cannot project or validate it would permit divergent
scenes. Rejected. The state and protocol versions create a coordinated deployment boundary.

### Arbitrary callback clip paths

Arbitrary paths would require different clipping implementations for canvas, DOM, SVG, minimap,
and hit testing. Rejected for the initial rectangular contract.

### Automatic drag containment

Containment based on a drag endpoint is ambiguous for overlapping elements and makes a move change
structure without an explicit command. Rejected. Frames and membership policy remain separate
work.

## Consequences

### Positive

- Scene consumers share one validated projection and one ordering rule.
- Parent movement, subtree commands, and descendant clipping have explicit history and rendering
  rules.
- State and sync peers either support the relationship contract or fail before relationship data is
  exchanged.
- Per-element authorization remains unchanged while the recipient projection hides a child whose
  parent is unavailable.

### Negative

- This is a pre-1.0 state and wire break that requires coordinated deployment of core and sync
  packages.
- Projection and subtree commands add validation, ordering, and history complexity.
- The initial contract supports rectangular clipping only.
- Raw storage can temporarily contain invalid remote relationships while it waits for repair.
- The depth limit of 32 rejects deeper hierarchies.
