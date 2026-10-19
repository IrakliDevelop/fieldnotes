# ADR-0008: Element Versioning, Tombstones and Fractional Order

- **Status:** Accepted
- **Deciders:** Project maintainer
- **Date:** 2026-10-19
- **Supersedes:** —
- **Related:** [ADR-0003](0003-sync-plugin-ownership.md) (sync plugin ownership),
  [ADR-0004](0004-serialization-compatibility.md) (serialization compatibility)

## Context

Elements were ordered by an integer `zIndex` (every factory wrote 0; ties fell back to insertion
order) and synced by arrival-order last-writer-wins with hard deletes. That caused:

- **TD-2:** the client's reconcile shield masked concurrent remote edits, because nothing said
  which write was newer.
- **S10:** across hub instances the Redis `HSET` order could differ from the pub/sub order, so
  peers on different instances could converge on different values.
- **S11:** the hub's ownership check and its write were not atomic across instances.
- Reordering rewrote neighbours' `zIndex`, so concurrent reorders collided.
- A delete left no trace, so a late upsert or a reconnecting peer resurrected the element.

Layers already had a working model: `LayerRecord` carries `version` and `editor` and is compared
by version, then editor.

## Decision

### D1 Model

`BaseElement` drops `zIndex` and gains `index: string` (a base-62 fractional order key),
`version: number` (≥ 1) and `editor?: string`. Elements stack by layer, then `index` (plain string
`<`), then `id`. Factories accept `index` (default `''`, meaning "place on top of the layer") and
`version` (default 1). Core exports `generateKeyBetween`, `generateNKeysBetween`,
`isValidIndexKey`, `pickBaseFields` (adapters copy base fields without listing them) and
`assignLegacyOrder` (gives pre-F1 elements keys in `zIndex`, then input, order).

### D2 Version rule in the store

Local mutations, including undo and redo, set `version` to the current one + 1 and drop `editor`.
Remote and other non-local mutations take `version` and `editor` verbatim when present. A client's
stored version therefore always equals the one the room accepted, and history never lowers it.
`bringToFront` and the other reorder commands write one element's `index`.

### D3 Persisted state v5

`CANVAS_STATE_VERSION` is 5. Version 1–4 files run through `assignLegacyOrder` before validation
and legacy decoding, so they load with the stacking order they had.

### D4 Legacy sync protocol 2

Legacy capabilities advertise `protocolVersion: 2`; authority capabilities stay at 1. Removes carry
`version` and `editor`; clears and snapshots carry tombstones `{ id, version, editor }`.
`SyncClient` applies an op only when it is newer (`isNewerVersion`), through a hub and peer to
peer, and keeps tombstones. A client that sees protocol 1 capabilities stops and closes its
transport; managed connections report `'unsupported'`.

### D5 Hub

The hub refuses protocol 1 connections with `4406`. Every element op reads the stored record,
resolves the audience, checks tombstone ownership, authorizes, runs plugins, checks the version,
then writes with compare-and-set and only then publishes; a conflict restarts it, up to 3 attempts.
Stale ops and version jumps over 1,000,000 get a correction. Tombstones keep `ownerId`, `audience`
and `removedBy` server-side and are filtered per viewer. `HubBackend` becomes `getRecord`,
`applyElement(room, write, expected)`, a compare-and-set on the stored `{ version, editor }` (so
two instances cannot both win an equal-version race), and `snapshot` returning elements and
tombstones, with a `tombstoneRetentionMs` option (default 7 days).

### D6 Redis

One Lua script performs the compare-and-set over the room hash and a `:tombstones` hash, including
`clear`. Rooms written before F1 get keys from `assignLegacyOrder` on first access per process.

### D7 authority:1

No runtime, proposal, digest or Lua change. `version` and `editor` are element data set by the
submitting client; the authority path never compares them. Hosts that load authority elements into
a core store run `assignLegacyOrder` first.

## Alternatives considered

### `isDeleted` elements in the store

Keeping deleted elements in `ElementStore` would have put tombstones next to live data, but every
`getAll()` consumer (more than 35) would need a filter. Rejected: tombstones live in the sync layer.

### Per-element `zIndex` to `index` conversion

Mapping each `zIndex` to a key on its own gives equal keys to elements that shared a `zIndex`, and
live rooms would then reorder by `id`. Rejected for the set-wise `assignLegacyOrder`.

### Mixed pre-F1 and F1 peers

Translating between protocol 1 and 2 would keep last-writer-wins by arrival alive for the whole
room. Rejected: upgrades are coordinated, and incompatible peers are refused instead of retried.

## Consequences

### Positive

- Every backend, including two hub instances on one Redis, keeps the newer write and never loses
  an accepted one (S10's ordering half, S11).
- Deleted elements stay deleted across late ops and reconnects.
- Reordering writes one element, and concurrent reorders converge.
- Old files and live rooms keep their stacking order.

### Negative

- **Pre-1.0 breaking change** to `BaseElement`, `HubBackend`, the legacy wire and persisted state.
  Clients, hubs and authority peers must be upgraded together.
- Layer versions are still unbounded: a client can inflate a layer's version the way the 1,000,000
  jump check now prevents for elements.
- A subscriber that drops a pub/sub message still misses it until its next snapshot (S10's other
  half); Redis Streams are left to sync-since diffs.
- `@fieldnotes/sync` and `@fieldnotes/sync-redis` import from `@fieldnotes/core` at runtime for
  the first time (`@fieldnotes/sync-server` through sync), so all three need core 0.93.0 or later.
- The Redis room migration orders elements by `HGETALL`, which is insertion order only for
  listpack-encoded hashes. Larger rooms get Redis' hash order, which is the order their pre-F1
  clients already saw on join.
- Element editors are client-chosen ids, so a client can bias equal-version ties. Ownership and
  `authorize` are unaffected.
- A file whose element versions exceed 1,000,000, loaded into a hub room, has its next edit
  corrected by the version jump limit: the hub has no record for those ids and answers with a
  remove.
- Client tombstones are never pruned, so a long peer-to-peer session keeps every deleted id in
  memory (tracked with F8 / 5.1).
